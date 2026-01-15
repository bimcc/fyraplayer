import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig, FMP4Source } from '../types.js';

/**
 * fMP4 Tech - handles fragmented MP4 streams without manifest (no .m3u8/.mpd)
 * Supports:
 * - fMP4 over HTTP (fetch + MSE)
 * - fMP4 over WebSocket (WS + MSE)
 * 
 * Uses MSE (MediaSource Extensions) to manually feed fMP4 segments
 */
export class FMP4Tech extends AbstractTech {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private ws: WebSocket | null = null;
  private abortController: AbortController | null = null;
  private pendingBuffers: ArrayBuffer[] = [];
  private isBufferUpdating = false;
  private mimeType = 'video/mp4; codecs="avc1.64001f,mp4a.40.2"';

  canPlay(source: Source): boolean {
    return source.type === 'fmp4';
  }

  async load(
    source: Source,
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
      webCodecs?: WebCodecsConfig;
    }
  ): Promise<void> {
    this.source = source;
    this.buffer = opts.buffer;
    this.reconnect = opts.reconnect;
    this.metrics = opts.metrics;
    this.video = opts.video;

    if (source.type !== 'fmp4') {
      throw new Error('FMP4Tech only supports fmp4 source type');
    }

    const fmp4Source = source as unknown as FMP4Source;
    
    // Determine MIME type based on codec hints
    this.mimeType = this.buildMimeType(fmp4Source);
    
    if (!MediaSource.isTypeSupported(this.mimeType)) {
      throw new Error(`MIME type not supported: ${this.mimeType}`);
    }

    await this.setupMediaSource(opts.video);
    
    if (fmp4Source.transport === 'ws') {
      await this.startWebSocket(fmp4Source.url);
    } else {
      await this.startHttpFetch(fmp4Source.url);
    }
  }

  private buildMimeType(source: FMP4Source): string {
    const videoCodec = source.codec === 'h265' 
      ? 'hvc1.1.6.L93.B0' 
      : source.codec === 'av1'
        ? 'av01.0.04M.08'
        : 'avc1.64001f';
    
    const audioCodec = source.audioCodec === 'opus'
      ? 'opus'
      : source.audioCodec === 'mp3'
        ? 'mp3'
        : 'mp4a.40.2';
    
    return `video/mp4; codecs="${videoCodec},${audioCodec}"`;
  }

  private async setupMediaSource(video: HTMLVideoElement): Promise<void> {
    return new Promise((resolve, reject) => {
      this.mediaSource = new MediaSource();
      video.src = URL.createObjectURL(this.mediaSource);
      
      this.mediaSource.addEventListener('sourceopen', () => {
        try {
          this.sourceBuffer = this.mediaSource!.addSourceBuffer(this.mimeType);
          this.sourceBuffer.mode = 'segments';
          
          this.sourceBuffer.addEventListener('updateend', () => {
            this.isBufferUpdating = false;
            this.flushPendingBuffers();
          });
          
          this.sourceBuffer.addEventListener('error', (e) => {
            this.bus.emit('error', { type: 'sourcebuffer-error', error: e });
          });
          
          this.bus.emit('ready');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      
      this.mediaSource.addEventListener('sourceended', () => {
        console.log('[fmp4] MediaSource ended');
      });
      
      this.mediaSource.addEventListener('sourceclose', () => {
        console.log('[fmp4] MediaSource closed');
      });
    });
  }

  private async startHttpFetch(url: string): Promise<void> {
    this.abortController = new AbortController();
    
    try {
      const response = await fetch(url, { signal: this.abortController.signal });
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      if (!response.body) {
        throw new Error('ReadableStream not supported');
      }
      
      const reader = response.body.getReader();
      
      while (true) {
        const { value, done } = await reader.read();
        
        if (done) {
          this.endOfStream();
          break;
        }
        
        if (value) {
          this.appendBuffer(value.buffer);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        this.bus.emit('error', { type: 'fetch-error', error: err });
        this.bus.emit('network', { type: 'fmp4-http-error', fatal: true });
      }
    }
  }

  private async startWebSocket(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';
      
      this.ws.onopen = () => {
        console.log('[fmp4] WebSocket connected');
        resolve();
      };
      
      this.ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.appendBuffer(event.data);
        }
      };
      
      this.ws.onerror = (err) => {
        this.bus.emit('error', { type: 'websocket-error', error: err });
        reject(err);
      };
      
      this.ws.onclose = (event) => {
        console.log('[fmp4] WebSocket closed', event.code, event.reason);
        if (!event.wasClean) {
          this.bus.emit('network', { type: 'fmp4-ws-closed', fatal: true });
        } else {
          this.endOfStream();
        }
      };
    });
  }

  private appendBuffer(data: ArrayBuffer): void {
    if (!this.sourceBuffer || this.mediaSource?.readyState !== 'open') {
      return;
    }
    
    this.pendingBuffers.push(data);
    this.flushPendingBuffers();
  }

  private flushPendingBuffers(): void {
    if (this.isBufferUpdating || !this.sourceBuffer || this.pendingBuffers.length === 0) {
      return;
    }
    
    if (this.mediaSource?.readyState !== 'open') {
      return;
    }
    
    try {
      const buffer = this.pendingBuffers.shift()!;
      this.isBufferUpdating = true;
      this.sourceBuffer.appendBuffer(buffer);
    } catch (err: any) {
      if (err.name === 'QuotaExceededError') {
        // Buffer full, try to remove old data
        this.removeOldBufferData();
      } else {
        this.bus.emit('error', { type: 'append-error', error: err });
      }
    }
  }

  private removeOldBufferData(): void {
    if (!this.sourceBuffer || !this.video || this.isBufferUpdating) {
      return;
    }
    
    const currentTime = this.video.currentTime;
    const removeEnd = Math.max(0, currentTime - 30); // Keep 30s of buffer behind
    
    if (removeEnd > 0 && this.sourceBuffer.buffered.length > 0) {
      try {
        this.isBufferUpdating = true;
        this.sourceBuffer.remove(0, removeEnd);
      } catch (err) {
        console.warn('[fmp4] Failed to remove old buffer data', err);
        this.isBufferUpdating = false;
      }
    }
  }

  private endOfStream(): void {
    if (this.mediaSource?.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch (err) {
        console.warn('[fmp4] endOfStream error', err);
      }
    }
  }

  override getStats() {
    if (this.video) {
      const quality = (this.video as any).getVideoPlaybackQuality?.();
      const buffered = this.sourceBuffer?.buffered;
      let bufferLevel = 0;
      
      if (buffered && buffered.length > 0) {
        const currentTime = this.video.currentTime;
        for (let i = 0; i < buffered.length; i++) {
          if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i)) {
            bufferLevel = buffered.end(i) - currentTime;
            break;
          }
        }
      }
      
      return {
        ts: Date.now(),
        fps: quality?.totalVideoFrames,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        droppedFrames: quality?.droppedVideoFrames,
        bufferLevel
      };
    }
    return super.getStats();
  }

  override async destroy(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    // Abort HTTP fetch
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    
    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    // Clear pending buffers
    this.pendingBuffers = [];
    this.isBufferUpdating = false;
    
    // Clean up MediaSource
    if (this.sourceBuffer) {
      try {
        if (this.mediaSource?.readyState === 'open') {
          this.mediaSource.removeSourceBuffer(this.sourceBuffer);
        }
      } catch { /* ignore */ }
      this.sourceBuffer = null;
    }
    
    if (this.mediaSource) {
      this.mediaSource = null;
    }
    
    // Clean up video element
    if (this.video) {
      URL.revokeObjectURL(this.video.src);
      this.video.src = '';
      this.video.srcObject = null;
      try { this.video.load(); } catch { /* ignore */ }
    }
  }
}
