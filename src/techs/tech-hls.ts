import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig, HLSSource } from '../types.js';
import Hls, { HlsConfig } from 'hls.js';
import { WebCodecsDecoder } from './wsRaw/webcodecsDecoder.js';
import { Renderer } from './wsRaw/renderer.js';
import { Demuxer } from './wsRaw/demuxer.js';
import { probeWebCodecs } from '../utils/webcodecs.js';
import { buildLowLatencyConfig } from './hlsConfig.js';

// Re-export for backwards compatibility
export { buildLowLatencyConfig } from './hlsConfig.js';

/**
 * HLS Tech - handles .m3u8 streams including LL-HLS
 * Uses hls.js for MSE-based playback, native HLS on Safari
 */
export class HLSTech extends AbstractTech {
  private hls?: Hls;
  private wcAbort: AbortController | null = null;
  private wcRenderer: Renderer | null = null;
  private wcDecoder: WebCodecsDecoder | null = null;
  private wcDemuxer: Demuxer | null = null;
  private hlsErrorHandler?: any;
  private hlsLevelHandler?: any;
  private hlsBufferHandler?: any;
  private hlsManifestHandler?: any;

  canPlay(source: Source): boolean {
    return source.type === 'hls';
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
    
    if (source.type !== 'hls') {
      throw new Error('HLSTech only supports hls source type');
    }
    
    await this.setupHls(source as HLSSource, opts.video, opts.webCodecs);
    this.bus.emit('ready');
  }

  private async setupHls(source: HLSSource, video: HTMLVideoElement, wc?: WebCodecsConfig): Promise<void> {
    this.cleanup();
    
    // Try WebCodecs path for TS segments
    if (wc?.enable && WebCodecsDecoder.isSupported() && (await this.isSafeForWebCodecs(source))) {
      try {
        await this.pullWithWebCodecs(source.url, video);
        return;
      } catch (err) {
        console.warn('[hls] WebCodecs pull failed, fallback to hls.js', err);
        this.cleanupWebCodecs();
      }
    }
    
    // Check native HLS support (Safari)
    const canNative = video.canPlayType('application/vnd.apple.mpegurl');
    
    // Build config with low-latency settings
    const lowLatencyConfig = buildLowLatencyConfig(source, this.buffer);
    const config: Partial<HlsConfig> = {
      capLevelToPlayerSize: true,
      ...lowLatencyConfig
    };
    
    if (canNative) {
      video.src = source.url;
      await video.load();
      return;
    }
    
    if (!Hls.isSupported()) {
      throw new Error('HLS not supported in this browser');
    }
    
    this.hls = new Hls(config);
    this.setupHlsEventHandlers(video);
    this.hls.loadSource(source.url);
    this.hls.attachMedia(video);
  }

  private setupHlsEventHandlers(video: HTMLVideoElement): void {
    if (!this.hls) return;
    
    this.hlsErrorHandler = (_e: any, data: any) => {
      this.bus.emit('error', data);
      if (data?.fatal) {
        this.bus.emit('network', { type: 'hls-fatal', details: data.details });
        this.hls?.recoverMediaError?.();
      }
    };
    
    this.hlsLevelHandler = (_e: any, data: any) => this.bus.emit('levelSwitch', data);
    this.hlsBufferHandler = () => this.bus.emit('buffer');
    
    this.hlsManifestHandler = (_e: any, _data: any) => {
      const maxH = this.deriveMaxHeight(video);
      if (this.hls?.levels?.length) {
        const capped = this.hls.levels.reduce(
          (acc, l, idx) => (l.height && l.height <= maxH ? idx : acc),
          this.hls.levels.length - 1
        );
        this.hls.autoLevelCapping = capped;
      }
    };
    
    this.hls.on(Hls.Events.ERROR, this.hlsErrorHandler);
    this.hls.on(Hls.Events.LEVEL_SWITCHED, this.hlsLevelHandler);
    this.hls.on(Hls.Events.BUFFER_APPENDED, this.hlsBufferHandler);
    this.hls.on(Hls.Events.MANIFEST_PARSED, this.hlsManifestHandler);
  }

  override getStats() {
    if (this.video && this.hls) {
      const quality = (this.video as any).getVideoPlaybackQuality?.();
      const hlsBitrate = this.hls.levels && this.hls.currentLevel >= 0 
        ? this.hls.levels[this.hls.currentLevel]?.bitrate 
        : undefined;
      return {
        ts: Date.now(),
        fps: quality?.totalVideoFrames,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        bitrateKbps: hlsBitrate ? Math.round(hlsBitrate / 1000) : undefined
      };
    }
    return super.getStats();
  }

  override async destroy(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    this.cleanupWebCodecs();
    if (this.hls) {
      if (this.hlsErrorHandler) this.hls.off(Hls.Events.ERROR, this.hlsErrorHandler);
      if (this.hlsLevelHandler) this.hls.off(Hls.Events.LEVEL_SWITCHED, this.hlsLevelHandler);
      if (this.hlsBufferHandler) this.hls.off(Hls.Events.BUFFER_APPENDED, this.hlsBufferHandler);
      if (this.hlsManifestHandler) this.hls.off(Hls.Events.MANIFEST_PARSED, this.hlsManifestHandler);
      try {
        this.hls.detachMedia();
      } catch { /* ignore */ }
      this.hls.destroy();
      this.hls = undefined;
    }
    if (this.video) {
      this.video.src = '';
      this.video.srcObject = null;
      try { this.video.load(); } catch { /* ignore */ }
    }
  }

  private cleanupWebCodecs(): void {
    if (this.wcAbort) {
      this.wcAbort.abort();
      this.wcAbort = null;
    }
    this.wcDecoder?.close();
    this.wcDecoder = null;
    this.wcRenderer?.destroy();
    this.wcRenderer = null;
    this.wcDemuxer = null;
  }

  private async isSafeForWebCodecs(source: HLSSource): Promise<boolean> {
    if ((source as any).drm) return false;
    if (!source.url.toLowerCase().endsWith('.ts')) return false;
    const support = await probeWebCodecs();
    return support.h264;
  }

  private async pullWithWebCodecs(url: string, video: HTMLVideoElement): Promise<void> {
    this.cleanupWebCodecs();
    this.wcAbort = new AbortController();
    this.wcRenderer = new Renderer(video);
    this.wcDemuxer = new Demuxer('ts');
    this.wcDecoder = new WebCodecsDecoder((frame) => this.wcRenderer?.renderFrame(frame));
    await this.wcDecoder.init();
    
    const res = await fetch(url, { signal: this.wcAbort.signal });
    if (!res.body) throw new Error('ReadableStream not supported');
    
    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const frames = this.wcDemuxer.demux(value.buffer);
      for (const f of frames) {
        this.wcDecoder.decode(f);
      }
    }
    
    if (!this.wcDecoder.hasOutput() || this.wcDecoder.hasErrors()) {
      throw new Error('HLS WebCodecs decode error, fallback to hls.js');
    }
  }

  private deriveMaxHeight(video: HTMLVideoElement): number {
    const cssH = video.clientHeight || 0;
    const screenH = window.innerHeight || 1080;
    return Math.max(cssH, screenH) || 1080;
  }
}
