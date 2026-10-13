import { AbstractTech } from './abstractTech.js';
import { MetadataEvent, MetadataDetectedEvent, Source, WSRawSource, TechLoadOptions } from '../types.js';
import { throwIfAborted, waitWithSignal } from '../core/abort.js';
import { WsRawPipeline } from './wsRaw/pipeline.js';
import { MseFallback } from './wsRaw/mseFallback.js';
import { DEFAULT_H264_DECODER_URL, DEFAULT_H264_DECODER_CANDIDATES } from './wsRaw/defaultDecoders.js';

/**
 * WS + WASM Tech stub
 * 自研管线：WS -> Demux(FLV/TS/AnnexB) -> JitterBuffer -> Decoder -> Renderer
 * 默认先走 MSE fallback，自研管线开启 experimental 时尝试，失败回落。
 */
export class WSRawTech extends AbstractTech {
  private pipeline: WsRawPipeline | null = null;
  private fallback: MseFallback | null = null;
  private useExperimental = false;
  private fallbackStarted = false;
  private pipelineActive = false;
  private frameHook?: (frame: VideoFrame) => void;
  private generation = 0;

  canPlay(source: Source): boolean {
    return source.type === 'ws-raw';
  }

  async load(
    source: Source,
    opts: TechLoadOptions
  ): Promise<void> {
    throwIfAborted(opts.signal);
    const wsSource = { ...(source as WSRawSource) };
    // set default decoderUrl when codec hint is missing
    if (!wsSource.decoderUrl) {
      if (wsSource.codec === 'h264') {
        // Prefer local candidate first, then fallback to CDN default.
        wsSource.decoderUrl = DEFAULT_H264_DECODER_CANDIDATES[0] || DEFAULT_H264_DECODER_URL;
      }
    }
    this.source = wsSource;
    this.buffer = opts.buffer;
    this.reconnect = opts.reconnect;
    this.metrics = opts.metrics;
    this.video = opts.video;
    this.cleanup();
    const generation = this.generation;
    const isCurrent = () => generation === this.generation && !opts.signal?.aborted;
    this.useExperimental = wsSource.pipeline === 'experimental';
    this.fallbackStarted = false;
    this.pipelineActive = false;

    let fallbackPromise: Promise<void> | undefined;
    const startFallback = (reason?: string): Promise<void> => {
      if (!isCurrent()) return Promise.resolve();
      if (fallbackPromise) return fallbackPromise;
      this.fallbackStarted = true;
      this.pipelineActive = false;
      fallbackPromise = Promise.resolve().then(async () => {
        if (!isCurrent()) return;
        this.pipeline?.stop();
        this.bus.emit('streamchange', { reason: 'fallback', source: { ...wsSource, pipeline: 'mse' } });
        if (!isCurrent()) return;
        this.fallback = new MseFallback();
        await waitWithSignal(this.fallback.start(wsSource.url, opts.video, {
          onReady: () => { if (isCurrent()) this.bus.emit('ready'); },
          onError: (e) => {
            if (!isCurrent()) return;
            this.bus.emit('error', e);
            this.bus.emit('network', { type: 'ws-fallback-error', fatal: true });
          }
        }, wsSource.transport === 'ts' ? 'mpegts' : 'flv', opts.mpegtsLoader), opts.signal);
        if (isCurrent() && reason) this.bus.emit('network', { type: 'fallback', reason });
      });
      return fallbackPromise;
    };
    const fallbackInBackground = (reason?: string) => {
      void startFallback(reason).catch(error => {
        if (!isCurrent()) return;
        this.bus.emit('error', error);
        if (isCurrent()) this.bus.emit('network', { type: 'ws-fallback-error', fatal: true });
      });
    };

    // Check if metadata extraction is enabled and valid
    const metadataConfig = this.getMetadataConfig(wsSource);

    try {
      if (this.useExperimental) {
        try {
          this.pipeline = new WsRawPipeline(wsSource, opts.video, opts.buffer, {
            onReady: () => { if (isCurrent() && !this.fallbackStarted) this.bus.emit('ready'); },
            onError: (e) => {
              if (!isCurrent() || this.fallbackStarted) return;
              this.bus.emit('error', e);
              fallbackInBackground();
            },
            onNetwork: (evt) => {
              if (!isCurrent() || this.fallbackStarted) return;
              // 自动回退：视频解码连续错误
              const decodeErrors = typeof evt?.errors === 'number' ? evt.errors : 0;
              if (evt?.type === 'video-decode-error' && decodeErrors >= 3) {
                fallbackInBackground('video-decode-error');
                return;
              }
              // 音频解码失败且音频为必需时切换到 MSE
              if (evt?.type === 'audio-fallback' && wsSource.audioOptional === false) {
                fallbackInBackground('audio-fallback');
                return;
              }
              this.bus.emit('network', evt);
            },
            onFallback: fallbackInBackground,
            // Metadata event handler - emit to EventBus
            onMetadata: metadataConfig.enabled
              ? (event: MetadataEvent) => { if (isCurrent() && !this.fallbackStarted) this.bus.emit('metadata', event); }
              : undefined,
            // Metadata detection handler - emit to EventBus
            onMetadataDetected: metadataConfig.detectOnly
              ? (event: MetadataDetectedEvent) => { if (isCurrent() && !this.fallbackStarted) this.bus.emit('metadata', event); }
              : undefined
          }, { webCodecsConfig: opts.webCodecs, frameHook: this.frameHook });
          await this.pipeline.start();
          throwIfAborted(opts.signal);
          if (!isCurrent()) return;
          this.pipelineActive = !this.fallbackStarted;
          if (fallbackPromise) await fallbackPromise;
          return;
        } catch (err) {
          throwIfAborted(opts.signal);
          if (fallbackPromise) throw err;
          console.warn('[ws-raw] experimental pipeline failed, falling back to MSE', err);
          this.pipeline?.stop();
          this.pipeline = null;
        }
      }
      // fallback path
      await startFallback();
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  /**
   * Get metadata configuration for the source.
   * Returns enabled status and detectOnly mode.
   */
  private getMetadataConfig(source: WSRawSource): { enabled: boolean; detectOnly: boolean } {
    // Metadata extraction only supported for TS transport
    if (source.transport !== 'ts') {
      return { enabled: false, detectOnly: false };
    }
    
    const metadata = source.metadata;
    if (!metadata) {
      return { enabled: false, detectOnly: false };
    }
    
    // Check if any metadata extraction is enabled
    const enabled = !!(metadata.privateData?.enable || metadata.sei?.enable);
    const detectOnly = !!(metadata.privateData?.detectOnly || metadata.sei?.detectOnly);
    
    return { enabled, detectOnly };
  }

  /**
   * Enable metadata extraction (for detectOnly mode).
   * Call this after receiving 'metadata-detected' events to start actual extraction.
   */
  enableMetadataExtraction(): void {
    if (this.pipeline) {
      this.pipeline.enableMetadataExtraction();
      console.log('[ws-raw] Metadata extraction enabled');
    }
  }

  /**
   * Disable metadata extraction.
   */
  disableMetadataExtraction(): void {
    if (this.pipeline) {
      this.pipeline.disableMetadataExtraction();
      console.log('[ws-raw] Metadata extraction disabled');
    }
  }

  /**
   * Set a VideoFrame hook (WebCodecs path only) for custom rendering pipelines (e.g., panorama/Cesium).
   * Hook is sync-only; the frame is closed after the callback returns.
   */
  setFrameHook(hook?: (frame: VideoFrame) => void): void {
    this.frameHook = hook;
    this.pipeline?.setFrameHook?.(hook);
  }

  /**
   * Get detected private data PIDs.
   */
  getDetectedPrivateDataPids(): number[] {
    return this.pipeline?.getDetectedPrivateDataPids() ?? [];
  }

  /**
   * Get detected SEI types.
   */
  getDetectedSeiTypes(): number[] {
    return this.pipeline?.getDetectedSeiTypes() ?? [];
  }

  override async destroy(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    ++this.generation;
    this.pipeline?.stop();
    this.pipeline = null;
    this.pipelineActive = false;
    this.fallback?.stop();
    this.fallback = null;
  }

  override getStats() {
    if (this.pipelineActive && this.pipeline) {
      return { ...this.pipeline.getStats() };
    }
    return super.getStats();
  }
}
