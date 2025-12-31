export interface DecodedFrame {
  width: number;
  height: number;
  y: Uint8Array;
  u: Uint8Array;
  v: Uint8Array;
}

/**
 * DecoderWorker: loads external WASM decoder script (decoderUrl) which must expose global `decode(nalus: Uint8Array[]): DecodedFrame[]`.
 * Uses pipeline mode for better performance - doesn't wait for each decode to complete.
 */
export class DecoderWorker {
  private worker: Worker | null = null;
  private decoderUrl?: string;
  private pendingDecodes: Map<number, (frames: DecodedFrame[]) => void> = new Map();
  private decodeId = 0;
  private outputQueue: DecodedFrame[] = [];
  private onFrame?: (frame: DecodedFrame) => void;

  constructor(decoderUrl?: string, onFrame?: (frame: DecodedFrame) => void) {
    this.decoderUrl = decoderUrl;
    this.onFrame = onFrame;
  }

  async init(): Promise<void> {
    if (this.worker) return;
    const code = `
      let ready = false;
      let decodeFn = null;
      self.onmessage = async (e) => {
        const { type, frames, decoderUrl, id } = e.data;
        if (type === 'init') {
          if (decoderUrl) {
            try {
              importScripts(decoderUrl);
              decodeFn = self.decode || null;
              ready = true;
            } catch (err) {
              self.postMessage({ type: 'error', error: 'Failed to load decoder: ' + err.message });
              return;
            }
          } else {
            ready = true;
          }
          self.postMessage({ type: 'ready' });
        } else if (type === 'decode') {
          if (!ready || !decodeFn) {
            self.postMessage({ type: 'decoded', id, frames: [] });
            return;
          }
          try {
            const out = decodeFn(frames);
            self.postMessage({ type: 'decoded', id, frames: out });
          } catch (err) {
            self.postMessage({ type: 'error', id, error: err?.message || 'decode error' });
          }
        }
      };
    `;
    const blob = new Blob([code], { type: 'application/javascript' });
    this.worker = new Worker(URL.createObjectURL(blob));
    
    this.worker.onmessage = (e) => {
      const { type, id, frames, error } = e.data;
      if (type === 'decoded') {
        const resolve = this.pendingDecodes.get(id);
        if (resolve) {
          this.pendingDecodes.delete(id);
          resolve(frames || []);
        }
        // Also push to output queue and call callback
        if (frames?.length && this.onFrame) {
          for (const frame of frames) {
            this.onFrame(frame);
          }
        }
        if (frames?.length) {
          this.outputQueue.push(...frames);
        }
      } else if (type === 'error') {
        console.warn('[DecoderWorker] error:', error);
        const resolve = this.pendingDecodes.get(id);
        if (resolve) {
          this.pendingDecodes.delete(id);
          resolve([]);
        }
      }
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker init timeout')), 10000);
      const handler = (e: MessageEvent) => {
        if (e.data.type === 'ready') {
          clearTimeout(timeout);
          this.worker!.removeEventListener('message', handler);
          resolve();
        } else if (e.data.type === 'error') {
          clearTimeout(timeout);
          this.worker!.removeEventListener('message', handler);
          reject(new Error(e.data.error));
        }
      };
      this.worker!.addEventListener('message', handler);
      this.worker!.postMessage({ type: 'init', decoderUrl: this.decoderUrl });
    });
  }

  /**
   * Decode NALUs - returns promise that resolves when decode completes.
   * For pipeline mode, you can fire multiple decodes without waiting.
   */
  async decode(nalus: Uint8Array[]): Promise<DecodedFrame[]> {
    const worker = this.worker;
    if (!worker) return [];
    
    const id = ++this.decodeId;
    return new Promise<DecodedFrame[]>((resolve) => {
      this.pendingDecodes.set(id, resolve);
      worker.postMessage({ type: 'decode', id, frames: nalus });
    });
  }

  /**
   * Fire-and-forget decode for pipeline mode.
   * Results will be delivered via onFrame callback.
   */
  decodeAsync(nalus: Uint8Array[]): void {
    const worker = this.worker;
    if (!worker) return;
    
    const id = ++this.decodeId;
    // Don't track promise, just fire
    worker.postMessage({ type: 'decode', id, frames: nalus });
  }

  /**
   * Get and clear accumulated output frames
   */
  drainOutput(): DecodedFrame[] {
    const out = this.outputQueue;
    this.outputQueue = [];
    return out;
  }

  /**
   * Get pending decode count
   */
  getPendingCount(): number {
    return this.pendingDecodes.size;
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingDecodes.clear();
    this.outputQueue = [];
  }
}
