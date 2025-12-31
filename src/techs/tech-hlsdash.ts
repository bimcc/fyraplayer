import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig, HLSSource } from '../types.js';
import Hls, { HlsConfig } from 'hls.js';
import dashjs from 'dashjs';
import { WebCodecsDecoder } from './wsRaw/webcodecsDecoder.js';
import { Renderer } from './wsRaw/renderer.js';
import { Demuxer } from './wsRaw/demuxer.js';
import { probeWebCodecs } from '../utils/webcodecs.js';
import { buildLowLatencyConfig } from './hlsConfig.js';

// Re-export for backwards compatibility
export { buildLowLatencyConfig } from './hlsConfig.js';

/**
 * HLS/DASH Tech with event cleanup and basic ABR capping.
 */
export class HLSDASHTech extends AbstractTech {
  private hls?: Hls;
  private dash?: dashjs.MediaPlayerClass;
  private wcAbort: AbortController | null = null;
  private wcRenderer: Renderer | null = null;
  private wcDecoder: WebCodecsDecoder | null = null;
  private wcDemuxer: Demuxer | null = null;
  private hlsErrorHandler?: any;
  private hlsLevelHandler?: any;
  private hlsBufferHandler?: any;
  private hlsManifestHandler?: any;
  private dashErrorHandler?: any;
  private dashLevelHandler?: any;

  canPlay(source: Source): boolean {
    return source.type === 'hls' || source.type === 'dash';
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
    if (source.type === 'hls') {
      await this.setupHls(source as Extract<Source, { type: 'hls' }>, opts.video, opts.webCodecs);
    } else if (source.type === 'dash') {
      await this.setupDash(source as Extract<Source, { type: 'dash' }>, opts.video, opts.webCodecs);
    } else {
      throw new Error('Unsupported source type for hlsdash tech');
    }
    this.bus.emit('ready');
  }

  private async setupHls(source: Extract<Source, { type: 'hls' }>, video: HTMLVideoElement, wc?: WebCodecsConfig): Promise<void> {
    this.cleanup();
    if (wc?.enable && WebCodecsDecoder.isSupported() && (await this.isSafeForWebCodecs(source))) {
      try {
        await this.pullWithWebCodecs(source.url, video);
        return;
      } catch (err) {
        console.warn('[hls] WebCodecs pull failed, fallback to hls.js', err);
        this.cleanupWebCodecs();
      }
    }
    const canNative = video.canPlayType('application/vnd.apple.mpegurl');
    
    // Build config with low-latency settings (Requirements 3.1-3.5)
    const lowLatencyConfig = buildLowLatencyConfig(source as HLSSource, this.buffer);
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
    this.hlsErrorHandler = (_e: any, data: any) => {
      this.bus.emit('error', data);
      if (data?.fatal) {
        this.bus.emit('network', { type: 'hls-fatal', details: data.details });
        // 先尝试恢复媒体错误，若不支持则靠外层回退
        this.hls?.recoverMediaError?.();
      }
    };
    this.hlsLevelHandler = (_e: any, data: any) => this.bus.emit('levelSwitch', data);
    this.hlsBufferHandler = () => this.bus.emit('buffer');
    this.hlsManifestHandler = (_e: any, _data: any) => {
      const maxH = this.deriveMaxHeight(video);
      if (this.hls?.levels?.length) {
        const capped = this.hls.levels.reduce((acc, l, idx) => (l.height && l.height <= maxH ? idx : acc), this.hls.levels.length - 1);
        this.hls.autoLevelCapping = capped;
      }
    };
    this.hls.on(Hls.Events.ERROR, this.hlsErrorHandler);
    this.hls.on(Hls.Events.LEVEL_SWITCHED, this.hlsLevelHandler);
    this.hls.on(Hls.Events.BUFFER_APPENDED, this.hlsBufferHandler);
    this.hls.on(Hls.Events.MANIFEST_PARSED, this.hlsManifestHandler);
    this.hls.loadSource(source.url);
    this.hls.attachMedia(video);
  }

  private async setupDash(source: Extract<Source, { type: 'dash' }>, video: HTMLVideoElement, wc?: WebCodecsConfig): Promise<void> {
    this.cleanup();
    this.dash = dashjs.MediaPlayer().create();
    this.dash.updateSettings({
      streaming: {
        abr: {
          limitBitrateByPortal: true
        }
      }
    } as any);
    this.dashErrorHandler = (e: any) => {
      const fatal = e?.event?.severity === 'fatal' || e?.error === 'capability';
      if (fatal) {
        this.bus.emit('error', e);
      } else {
        this.bus.emit('network', { type: 'dash-error', details: e });
      }
    };
    this.dashLevelHandler = (e: any) => this.bus.emit('levelSwitch', e);
    this.dash.on('error', this.dashErrorHandler);
    this.dash.on('qualityChangeRendered', this.dashLevelHandler);
    this.dash.initialize(video, source.url, false);
    if (wc?.allowH265) {
      probeWebCodecs().then((support) => {
        if (support.h265) {
          console.info('[dash] H.265 supported by browser (native/MSE path)');
        } else {
          console.info('[dash] H.265 not supported, staying on MSE fallback');
        }
      });
    }
  }

  override getStats() {
    if (this.video) {
      const quality = (this.video as any).getVideoPlaybackQuality?.();
      const hlsBitrate = this.hls && this.hls.levels && this.hls.currentLevel >= 0 ? this.hls.levels[this.hls.currentLevel]?.bitrate : undefined;
      const dashBitrate =
        (this.dash?.getDashMetrics()?.getCurrentRepresentationSwitch('video') as any)?.bandwidth ||
        (this.dash?.getDashMetrics()?.getCurrentHttpRequest('video') as any)?.bandwidth;
      return {
        ts: Date.now(),
        fps: quality?.totalVideoFrames,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        bitrateKbps: (hlsBitrate || dashBitrate) ? Math.round((hlsBitrate || dashBitrate) / 1000) : undefined
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
      } catch {
        /* ignore */
      }
      this.hls.destroy();
      this.hls = undefined;
    }
    if (this.dash) {
      if (this.dashErrorHandler) this.dash.off('error', this.dashErrorHandler);
      if (this.dashLevelHandler) this.dash.off('qualityChangeRendered', this.dashLevelHandler);
      this.dash.reset();
      this.dash = undefined;
    }
    if (this.video) {
      this.video.src = '';
      this.video.srcObject = null;
      try {
        this.video.load();
      } catch {
        /* ignore */
      }
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

  private async isSafeForWebCodecs(source: Extract<Source, { type: 'hls' }>): Promise<boolean> {
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
    const est = Math.max(cssH, screenH);
    return est || 1080;
  }
}
