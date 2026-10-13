import { AbstractTech } from './abstractTech.js';
import { Source, TechLoadOptions, FMP4Source, FMP4BufferPolicy } from '../types.js';
import { abortReason, throwIfAborted, waitWithSignal } from '../core/abort.js';
import { buildBrowserManagedMp4MimeCandidates, selectSupportedMediaSourceMime } from '../utils/browserCodecs.js';

interface ErrorWithName {
  name?: string;
}

interface VideoPlaybackQualityLike {
  totalVideoFrames?: number;
  droppedVideoFrames?: number;
}

interface PendingFmp4Segment {
  data: ArrayBuffer;
  bytes: number;
  quotaRetries: number;
}

const DEFAULT_FMP4_BUFFER_POLICY: Required<FMP4BufferPolicy> = {
  maxPendingSegments: 120,
  maxPendingBytes: 64 * 1024 * 1024,
  overflowStrategy: 'drop-oldest',
  quotaCleanupKeepBehindMs: 12_000,
  quotaRetryLimit: 2
};

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
  private httpPumpPromise: Promise<void> | null = null;
  private destroyed = false;
  private generation = 0;
  private objectUrl: string | null = null;
  private httpReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private pendingBuffers: PendingFmp4Segment[] = [];
  private pendingBytes = 0;
  private isBufferUpdating = false;
  private mimeType = 'video/mp4; codecs="avc1.64001f,mp4a.40.2"';

  canPlay(source: Source): boolean {
    return source.type === 'fmp4';
  }

  async load(
    source: Source,
    opts: TechLoadOptions
  ): Promise<void> {
    throwIfAborted(opts.signal);
    this.cleanup();
    const generation = this.generation;
    this.source = source;
    this.buffer = opts.buffer;
    this.reconnect = opts.reconnect;
    this.metrics = opts.metrics;
    this.video = opts.video;
    this.destroyed = false;

    if (source.type !== 'fmp4') {
      throw new Error('FMP4Tech only supports fmp4 source type');
    }

    const fmp4Source = source;
    
    // Determine MIME type based on codec hints and choose the first browser-supported candidate.
    const mimeCandidates = this.buildMimeCandidates(fmp4Source);
    const selection = selectSupportedMediaSourceMime(mimeCandidates);
    if (!selection.mimeType) {
      const error = {
        type: 'fmp4-codec-unsupported',
        codec: fmp4Source.codec,
        mimeTypes: mimeCandidates,
        fatal: true
      };
      this.bus.emit('network', error);
      this.bus.emit('error', error);
      throw new Error(`MIME type not supported for fMP4 source: ${mimeCandidates.join(', ')}`);
    }
    this.mimeType = selection.mimeType;
    this.bus.emit('network', { type: 'fmp4-codec-selected', mimeType: this.mimeType });

    const controller = new AbortController();
    this.abortController = controller;
    const cancel = () => controller.abort(opts.signal && abortReason(opts.signal));
    opts.signal?.addEventListener('abort', cancel, { once: true });
    if (opts.signal?.aborted) cancel();
    try {
      throwIfAborted(controller.signal);
      await this.setupMediaSource(opts.video, controller.signal, generation);
      throwIfAborted(controller.signal);
      if (fmp4Source.transport === 'ws') {
        await this.startWebSocket(fmp4Source.url, controller.signal, generation);
      } else {
        await this.startHttpFetch(fmp4Source.url, controller.signal, generation);
      }
      throwIfAborted(controller.signal);
    } catch (error) {
      if (generation === this.generation) this.cleanup();
      throw error;
    } finally {
      opts.signal?.removeEventListener('abort', cancel);
    }
  }

  private buildMimeCandidates(source: FMP4Source): string[] {
    if (source.mimeType) {
      return [source.mimeType];
    }

    return buildBrowserManagedMp4MimeCandidates(source);
  }

  private async setupMediaSource(video: HTMLVideoElement, signal: AbortSignal, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const mediaSource = new MediaSource();
      this.mediaSource = mediaSource;
      this.objectUrl = URL.createObjectURL(mediaSource);
      video.src = this.objectUrl;
      const detach = () => {
        signal.removeEventListener('abort', cancel);
        mediaSource.removeEventListener('sourceopen', open);
        mediaSource.removeEventListener('sourceclose', close);
      };
      const cancel = () => { detach(); reject(abortReason(signal)); };
      const close = () => { detach(); reject(new Error('MediaSource closed before opening')); };
      const open = () => {
        detach();
        try {
          throwIfAborted(signal);
          if (generation !== this.generation) throw new DOMException('Stale MediaSource', 'AbortError');
          const sourceBuffer = mediaSource.addSourceBuffer(this.mimeType);
          this.sourceBuffer = sourceBuffer;
          sourceBuffer.mode = 'segments';
          sourceBuffer.addEventListener('updateend', () => {
            if (generation !== this.generation || signal.aborted) return;
            this.isBufferUpdating = false;
            this.flushPendingBuffers();
          });
          sourceBuffer.addEventListener('error', (e) => {
            if (generation !== this.generation || signal.aborted) return;
            this.bus.emit('error', { type: 'sourcebuffer-error', error: e });
          });
          this.bus.emit('ready');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      mediaSource.addEventListener('sourceopen', open);
      mediaSource.addEventListener('sourceclose', close);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }

  private async startHttpFetch(url: string, signal: AbortSignal, generation: number): Promise<void> {
    try {
      const request = this.source?.type === 'fmp4' ? this.source.request : undefined;
      const response = await waitWithSignal(fetch(url, {
        signal,
        headers: request?.headers,
        credentials: request?.credentials
      }).then(response => {
        if (signal.aborted) void response.body?.cancel().catch(() => {});
        throwIfAborted(signal);
        return response;
      }), signal);
      throwIfAborted(signal);
      
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      
      if (!response.body) {
        throw new Error('ReadableStream not supported');
      }
      
      const reader = response.body.getReader();
      this.httpReader = reader;
      const pumpPromise = this.pumpHttpReadableStream(reader, signal, generation);
      this.httpPumpPromise = pumpPromise;
      void pumpPromise.finally(() => {
        if (this.httpPumpPromise === pumpPromise) {
          this.httpPumpPromise = null;
        }
      });
    } catch (err) {
      const error = err as ErrorWithName;
      if (!signal.aborted && generation === this.generation && error.name !== 'AbortError') {
        this.bus.emit('error', { type: 'fetch-error', error: err });
        this.bus.emit('network', { type: 'fmp4-http-error', fatal: true });
      }
      throw err;
    }
  }

  private async pumpHttpReadableStream(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal, generation: number): Promise<void> {
    try {
      while (!this.destroyed && generation === this.generation) {
        const { value, done } = await waitWithSignal(reader.read(), signal);
        throwIfAborted(signal);
        if (generation !== this.generation) break;
        
        if (done) {
          this.endOfStream();
          break;
        }
        
        if (value) {
          const chunk = value.slice().buffer;
          this.appendBuffer(chunk);
        }
      }
    } catch (err) {
      const error = err as ErrorWithName;
      if (!this.destroyed && !signal.aborted && generation === this.generation && error.name !== 'AbortError') {
        this.bus.emit('error', { type: 'fetch-error', error: err });
        this.bus.emit('network', { type: 'fmp4-http-error', fatal: true });
      }
    } finally {
      if (this.httpReader === reader) this.httpReader = null;
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }

  private async startWebSocket(url: string, signal: AbortSignal, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      let opened = false;
      const active = () => generation === this.generation && !signal.aborted;
      const cancel = () => { signal.removeEventListener('abort', cancel); reject(abortReason(signal)); };
      signal.addEventListener('abort', cancel, { once: true });
      ws.onopen = () => {
        if (!active()) return;
        opened = true;
        signal.removeEventListener('abort', cancel);
        resolve();
      };
      ws.onmessage = (event) => {
        if (!active()) return;
        if (event.data instanceof ArrayBuffer) {
          this.appendBuffer(event.data);
        }
      };
      
      ws.onerror = (err) => {
        if (!active()) return;
        signal.removeEventListener('abort', cancel);
        this.bus.emit('error', { type: 'websocket-error', error: err });
        reject(err);
      };
      
      ws.onclose = (event) => {
        if (!active()) return;
        signal.removeEventListener('abort', cancel);
        if (!opened) reject(new Error('fMP4 WebSocket closed before opening'));
        if (!event.wasClean) {
          this.bus.emit('network', { type: 'fmp4-ws-closed', fatal: true });
        } else {
          this.endOfStream();
        }
      };
      if (signal.aborted) cancel();
    });
  }

  private appendBuffer(data: ArrayBuffer): void {
    if (!this.sourceBuffer || this.mediaSource?.readyState !== 'open') {
      return;
    }
    
    if (this.enqueuePendingBuffer(data)) {
      this.flushPendingBuffers();
    }
  }

  private flushPendingBuffers(): void {
    if (
      this.isBufferUpdating ||
      !this.sourceBuffer ||
      this.sourceBuffer.updating ||
      this.pendingBuffers.length === 0
    ) {
      return;
    }
    
    if (this.mediaSource?.readyState !== 'open') {
      return;
    }
    
    const segment = this.dequeuePendingBuffer();
    if (!segment) return;

    try {
      this.isBufferUpdating = true;
      this.sourceBuffer.appendBuffer(segment.data);
    } catch (err) {
      const error = err as ErrorWithName;
      this.isBufferUpdating = false;
      if (error.name === 'QuotaExceededError') {
        this.handleQuotaExceeded(segment, err);
      } else {
        this.bus.emit('error', { type: 'append-error', error: err });
      }
    }
  }

  private enqueuePendingBuffer(data: ArrayBuffer): boolean {
    const segment: PendingFmp4Segment = {
      data,
      bytes: data.byteLength,
      quotaRetries: 0
    };
    this.pendingBuffers.push(segment);
    this.pendingBytes += segment.bytes;
    return this.enforcePendingQueueLimits(segment);
  }

  private dequeuePendingBuffer(): PendingFmp4Segment | undefined {
    const segment = this.pendingBuffers.shift();
    if (segment) {
      this.pendingBytes = Math.max(0, this.pendingBytes - segment.bytes);
    }
    return segment;
  }

  private requeuePendingBuffer(segment: PendingFmp4Segment): void {
    this.pendingBuffers.unshift(segment);
    this.pendingBytes += segment.bytes;
  }

  private getFmp4BufferPolicy(): Required<FMP4BufferPolicy> {
    return {
      ...DEFAULT_FMP4_BUFFER_POLICY,
      quotaCleanupKeepBehindMs: this.buffer?.maxBufferMs ?? DEFAULT_FMP4_BUFFER_POLICY.quotaCleanupKeepBehindMs,
      ...this.buffer?.fmp4
    };
  }

  private enforcePendingQueueLimits(newestSegment: PendingFmp4Segment): boolean {
    const policy = this.getFmp4BufferPolicy();
    if (!this.isPendingQueueOverLimit(policy)) {
      return true;
    }

    const dropped: PendingFmp4Segment[] = [];

    if (policy.overflowStrategy === 'error') {
      this.removeSpecificPendingSegment(newestSegment, dropped);
      this.emitBackpressure(dropped, policy, 'error');
      this.bus.emit('error', { type: 'fmp4-backpressure', pendingSegments: this.pendingBuffers.length, pendingBytes: this.pendingBytes });
      return false;
    }

    while (this.isPendingQueueOverLimit(policy) && this.pendingBuffers.length > 0) {
      const segment = policy.overflowStrategy === 'drop-newest'
        ? this.pendingBuffers.pop()
        : this.pendingBuffers.shift();
      if (!segment) break;
      this.pendingBytes = Math.max(0, this.pendingBytes - segment.bytes);
      dropped.push(segment);
    }

    if (dropped.length > 0) {
      this.emitBackpressure(dropped, policy, policy.overflowStrategy);
    }

    return this.pendingBuffers.includes(newestSegment);
  }

  private isPendingQueueOverLimit(policy: Required<FMP4BufferPolicy>): boolean {
    return this.pendingBuffers.length > policy.maxPendingSegments || this.pendingBytes > policy.maxPendingBytes;
  }

  private removeSpecificPendingSegment(target: PendingFmp4Segment, dropped: PendingFmp4Segment[]): void {
    const index = this.pendingBuffers.indexOf(target);
    if (index < 0) return;
    const [segment] = this.pendingBuffers.splice(index, 1);
    if (!segment) return;
    this.pendingBytes = Math.max(0, this.pendingBytes - segment.bytes);
    dropped.push(segment);
  }

  private emitBackpressure(
    dropped: PendingFmp4Segment[],
    policy: Required<FMP4BufferPolicy>,
    strategy: FMP4BufferPolicy['overflowStrategy'] | 'quota-retry-exhausted'
  ): void {
    const droppedBytes = dropped.reduce((total, segment) => total + segment.bytes, 0);
    this.bus.emit('network', {
      type: 'fmp4-backpressure',
      severity: 'warning',
      dropped: dropped.length,
      droppedBytes,
      pendingSegments: this.pendingBuffers.length,
      pendingBytes: this.pendingBytes,
      maxPendingSegments: policy.maxPendingSegments,
      maxPendingBytes: policy.maxPendingBytes,
      strategy
    });
    this.bus.emit('buffer', {
      pendingSegments: this.pendingBuffers.length,
      pendingBytes: this.pendingBytes,
      dropped: dropped.length,
      droppedBytes
    });
  }

  private handleQuotaExceeded(segment: PendingFmp4Segment, error: unknown): void {
    const policy = this.getFmp4BufferPolicy();
    segment.quotaRetries += 1;

    this.bus.emit('network', {
      type: 'fmp4-quota-exceeded',
      severity: 'warning',
      pendingSegments: this.pendingBuffers.length,
      pendingBytes: this.pendingBytes,
      attempt: segment.quotaRetries,
      maxRetries: policy.quotaRetryLimit
    });

    if (segment.quotaRetries <= policy.quotaRetryLimit) {
      this.requeuePendingBuffer(segment);
      if (this.removeOldBufferData(policy)) {
        return;
      }
      this.dequeueSpecificPendingBuffer(segment);
    }

    if (policy.overflowStrategy === 'error') {
      this.bus.emit('error', { type: 'quota-exceeded', error });
      return;
    }

    this.emitBackpressure([segment], policy, 'quota-retry-exhausted');
    this.flushPendingBuffers();
  }

  private dequeueSpecificPendingBuffer(target: PendingFmp4Segment): void {
    const index = this.pendingBuffers.indexOf(target);
    if (index < 0) return;
    const [segment] = this.pendingBuffers.splice(index, 1);
    if (segment) {
      this.pendingBytes = Math.max(0, this.pendingBytes - segment.bytes);
    }
  }

  private removeOldBufferData(policy: Required<FMP4BufferPolicy>): boolean {
    if (!this.sourceBuffer || !this.video || this.isBufferUpdating || this.sourceBuffer.updating) {
      return false;
    }
    
    const currentTime = this.video.currentTime;
    const keepBehindSeconds = Math.max(0, policy.quotaCleanupKeepBehindMs / 1000);
    const removeEnd = Math.max(0, currentTime - keepBehindSeconds);
    
    if (removeEnd <= 0 || this.sourceBuffer.buffered.length === 0) {
      return false;
    }

    const removeStart = this.sourceBuffer.buffered.start(0);
    const safeRemoveEnd = Math.min(removeEnd, this.sourceBuffer.buffered.end(this.sourceBuffer.buffered.length - 1));
    if (safeRemoveEnd <= removeStart) {
      return false;
    }

    try {
      this.isBufferUpdating = true;
      this.sourceBuffer.remove(removeStart, safeRemoveEnd);
      return true;
    } catch (err) {
      console.warn('[fmp4] Failed to remove old buffer data', err);
      this.isBufferUpdating = false;
      return false;
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
      const videoWithPlaybackQuality = this.video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => VideoPlaybackQualityLike;
      };
      const quality = videoWithPlaybackQuality.getVideoPlaybackQuality?.();
      const now = Date.now();
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
        ts: now,
        fps: this.calculatePlaybackFps(quality?.totalVideoFrames, now),
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        droppedFrames: quality?.droppedVideoFrames,
        bufferLevel,
        pendingSegments: this.pendingBuffers.length,
        pendingBytes: this.pendingBytes
      };
    }
    return super.getStats();
  }

  override async destroy(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    this.generation += 1;
    this.destroyed = true;
    this.resetPlaybackFpsSampler();
    // Abort HTTP fetch
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.httpPumpPromise = null;
    const reader = this.httpReader;
    this.httpReader = null;
    if (reader?.cancel) void reader.cancel().catch(() => {});
    
    // Close WebSocket
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    
    // Clear pending buffers
    this.pendingBuffers = [];
    this.pendingBytes = 0;
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
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    if (this.video) {
      this.video.src = '';
      this.video.srcObject = null;
      try { this.video.load(); } catch { /* ignore */ }
    }
  }
}
