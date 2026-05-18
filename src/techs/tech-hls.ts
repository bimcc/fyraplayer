import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig, HLSSource, QualityState } from '../types.js';
import Hls, { HlsConfig } from 'hls.js';
import { WebCodecsDecoder } from './wsRaw/webcodecsDecoder.js';
import { Renderer } from './wsRaw/renderer.js';
import { Demuxer } from './wsRaw/demuxer.js';
import { probeWebCodecs } from '../utils/webcodecs.js';
import { buildHlsPlaybackConfig, buildLowLatencyConfig } from './hlsConfig.js';
import { decideWebCodecsCodec } from '../utils/decodeDecision.js';

type HlsEventHandler = (...args: unknown[]) => void;

interface HlsLevelSwitchPayload {
  level?: number;
}

interface HlsErrorPayload {
  type?: string;
  details?: string;
  fatal?: boolean;
  error?: unknown;
}

type HlsWithStopLoad = Hls & {
  stopLoad?: () => void;
};

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
  private hlsErrorHandler?: HlsEventHandler;
  private hlsLevelHandler?: HlsEventHandler;
  private hlsManifestHandler?: HlsEventHandler;
  private hlsFragBufferedHandler?: HlsEventHandler;
  private readyEmitted = false;

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
    
    await this.setupHls(source, opts.video, opts.webCodecs);
  }

  private async setupHls(source: HLSSource, video: HTMLVideoElement, wc?: WebCodecsConfig): Promise<void> {
    this.cleanup();
    
    // Try WebCodecs path for TS segments
    if (wc?.enable && WebCodecsDecoder.isSupported() && (await this.isSafeForWebCodecs(source))) {
      try {
        await this.pullWithWebCodecs(source.url, video, wc);
        this.emitReadyOnce();
        return;
      } catch (err) {
        console.warn('[hls] WebCodecs pull failed, fallback to hls.js', err);
        this.cleanupWebCodecs();
      }
    }
    
    // Build config - keep LL-HLS explicit and force normal live HLS into a
    // buffered mode instead of inheriting hls.js lowLatencyMode defaults.
    const config: Partial<HlsConfig> = {
      debug: false,
      capLevelToPlayerSize: true,
      enableWorker: true,
      ...buildHlsPlaybackConfig(source, this.buffer)
    };
    
    // Priority: hls.js (MSE) > native HLS (Safari/iOS only)
    // Chrome/Edge return "maybe" for canPlayType but their native HLS is unreliable
    // Only Safari/iOS have proper native HLS support
    if (Hls.isSupported()) {
      // Use hls.js for consistent cross-browser behavior
      console.log('[hls] Using hls.js (MSE)');
      this.hls = new Hls(config);
      this.hls.attachMedia(video);
      this.setupHlsEventHandlers(video);
      this.hls.loadSource(source.url);
      return;
    }
    
    // Fallback to native HLS only when hls.js is not supported (Safari/iOS)
    const canNative = video.canPlayType('application/vnd.apple.mpegurl');
    if (canNative) {
      console.log('[hls] Using native HLS (Safari/iOS fallback)');
      video.onloadedmetadata = () => this.emitReadyOnce();
      video.oncanplay = () => this.emitReadyOnce();
      video.src = source.url;
      video.load();
      return;
    }
    
    throw new Error('HLS not supported in this browser');
  }

  private setupHlsEventHandlers(video: HTMLVideoElement): void {
    if (!this.hls) return;

    const asErrorPayload = (value: unknown): HlsErrorPayload => {
      if (typeof value !== 'object' || value === null) return {};
      return value as HlsErrorPayload;
    };
    
    this.hlsErrorHandler = (_event: unknown, payload: unknown) => {
      const data = asErrorPayload(payload);
      if (data?.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
        this.bus.emit('buffer');
      }
      if (data?.fatal) {
        this.bus.emit('error', data);
        this.bus.emit('network', { type: 'hls-fatal', details: data.details, fatal: true });
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          this.hls?.recoverMediaError?.();
        } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          this.hls?.startLoad?.();
        }
        return;
      }
      this.bus.emit('network', {
        type: 'hls-warning',
        details: data.details,
        hlsType: data.type,
        severity: 'warning'
      });
    };
    
    this.hlsLevelHandler = (_event: unknown, payload: unknown) => {
      const data = this.asLevelSwitchPayload(payload);
      const level = typeof data.level === 'number' ? this.hls?.levels?.[data.level] : undefined;
      this.bus.emit('levelSwitch', {
        tech: 'hls',
        to: data.level,
        bitrateKbps: level?.bitrate ? Math.round(level.bitrate / 1000) : undefined,
        width: level?.width,
        height: level?.height,
        codec: level?.videoCodec
      });
    };
    this.hlsManifestHandler = (_event: unknown, _data: unknown) => {
      const maxH = this.deriveMaxHeight(video);
      if (this.hls?.levels?.length) {
        const capped = this.hls.levels.reduce(
          (acc, l, idx) => (l.height && l.height <= maxH ? idx : acc),
          this.hls.levels.length - 1
        );
        this.hls.autoLevelCapping = capped;
      }
    };
    this.hlsFragBufferedHandler = () => this.emitReadyOnce();
    
    this.hls.on(Hls.Events.ERROR, this.hlsErrorHandler);
    this.hls.on(Hls.Events.LEVEL_SWITCHED, this.hlsLevelHandler);
    this.hls.on(Hls.Events.MANIFEST_PARSED, this.hlsManifestHandler);
    this.hls.on(Hls.Events.FRAG_BUFFERED, this.hlsFragBufferedHandler);
  }

  override getStats() {
    if (this.video && this.hls) {
      const videoWithPlaybackQuality = this.video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { totalVideoFrames?: number };
      };
      const quality = videoWithPlaybackQuality.getVideoPlaybackQuality?.();
      const now = Date.now();
      const hlsBitrate = this.hls.levels && this.hls.currentLevel >= 0 
        ? this.hls.levels[this.hls.currentLevel]?.bitrate 
        : undefined;
      return {
        ts: now,
        fps: this.calculatePlaybackFps(quality?.totalVideoFrames, now),
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
    this.resetPlaybackFpsSampler();
    this.cleanupWebCodecs();
    if (this.hls) {
      if (this.hlsErrorHandler) this.hls.off(Hls.Events.ERROR, this.hlsErrorHandler);
      if (this.hlsLevelHandler) this.hls.off(Hls.Events.LEVEL_SWITCHED, this.hlsLevelHandler);
      if (this.hlsManifestHandler) this.hls.off(Hls.Events.MANIFEST_PARSED, this.hlsManifestHandler);
      if (this.hlsFragBufferedHandler) this.hls.off(Hls.Events.FRAG_BUFFERED, this.hlsFragBufferedHandler);
      try {
        (this.hls as HlsWithStopLoad).stopLoad?.();
      } catch { /* ignore */ }
      try {
        this.hls.detachMedia();
      } catch { /* ignore */ }
      this.hls.destroy();
      this.hls = undefined;
    }
    this.hlsErrorHandler = undefined;
    this.hlsLevelHandler = undefined;
    this.hlsManifestHandler = undefined;
    this.hlsFragBufferedHandler = undefined;
    if (this.video) {
      this.video.onloadedmetadata = null;
      this.video.onloadeddata = null;
      this.video.oncanplay = null;
      this.video.onerror = null;
      try { this.video.pause(); } catch { /* ignore */ }
      this.video.srcObject = null;
      try {
        this.video.removeAttribute('src');
        this.video.load();
      } catch { /* ignore */ }
    }
    this.readyEmitted = false;
  }

  getQualityState(): QualityState {
    if (!this.hls) {
      return { supported: false, tech: 'hls', auto: true, current: null, levels: [] };
    }
    const current = this.hls.currentLevel >= 0 ? this.hls.currentLevel : null;
    return {
      supported: true,
      tech: 'hls',
      auto: this.hls.autoLevelEnabled,
      current,
      levels: this.hls.levels.map((level, index) => ({
        id: index,
        index,
        label: this.formatQualityLabel(level.height, level.bitrate),
        bitrateKbps: level.bitrate ? Math.round(level.bitrate / 1000) : undefined,
        width: level.width,
        height: level.height,
        codec: level.videoCodec,
        active: current === index
      }))
    };
  }

  async setQualityLevel(level: number | string | 'auto'): Promise<void> {
    if (!this.hls) throw new Error('HLS is not loaded');
    if (level === 'auto') {
      this.hls.currentLevel = -1;
      return;
    }
    const index = typeof level === 'number' ? level : Number(level);
    if (!Number.isInteger(index) || index < 0 || index >= this.hls.levels.length) {
      throw new Error(`Invalid HLS quality level: ${level}`);
    }
    this.hls.currentLevel = index;
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
    if (source.drm) return false;
    if (!source.url.toLowerCase().endsWith('.ts')) return false;
    const support = await probeWebCodecs();
    return support.h264;
  }

  private async pullWithWebCodecs(url: string, video: HTMLVideoElement, wc?: WebCodecsConfig): Promise<void> {
    this.cleanupWebCodecs();
    this.wcAbort = new AbortController();
    this.wcRenderer = new Renderer(video);
    this.wcDemuxer = new Demuxer('ts');
    this.wcDecoder = new WebCodecsDecoder((frame) => this.wcRenderer?.renderFrame(frame));
    await this.wcDecoder.init(false);
    let configured = false;
    let configuredCodec: string | null = null;
    
    const res = await fetch(url, { signal: this.wcAbort.signal });
    if (!res.body) throw new Error('ReadableStream not supported');
    
    const reader = res.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const frames = this.wcDemuxer.demux(value.buffer);
      for (const f of frames) {
        if (f.track !== 'video') continue;
        if (!configured) {
          const decision = await decideWebCodecsCodec({
            annexb: f.data,
            codecHint: 'h264',
            allowH265: wc?.allowH265
          });
          if (!decision.supported || !decision.codec) {
            throw new Error(`WebCodecs configure failed: ${decision.reason ?? 'unsupported'}`);
          }
          const ok = await this.wcDecoder.configure(decision.codec);
          if (!ok) {
            throw new Error(`WebCodecs configure failed for codec ${decision.codec}`);
          }
          configured = true;
          configuredCodec = decision.codec;
        }
        this.wcDecoder.decode(f);
      }
    }
    
    if (!configured || !this.wcDecoder.hasOutput() || this.wcDecoder.hasErrors()) {
      this.wcRenderer?.destroy();
      this.wcRenderer = null;
      this.wcDecoder?.close();
      this.wcDecoder = null;
      this.wcDemuxer = null;
      throw new Error('HLS WebCodecs decode error, fallback to hls.js');
    }
    this.bus.emit('qos', { type: 'webcodecs-config', codec: configuredCodec });
  }

  private deriveMaxHeight(video: HTMLVideoElement): number {
    const cssH = video.clientHeight || 0;
    const screenH = window.innerHeight || 1080;
    return Math.max(cssH, screenH) || 1080;
  }

  private emitReadyOnce(): void {
    if (this.readyEmitted) return;
    this.readyEmitted = true;
    this.bus.emit('ready');
  }

  private asLevelSwitchPayload(value: unknown): HlsLevelSwitchPayload {
    if (typeof value !== 'object' || value === null) return {};
    return value as HlsLevelSwitchPayload;
  }

  private formatQualityLabel(height?: number, bitrate?: number): string {
    const parts: string[] = [];
    if (height) parts.push(`${height}p`);
    if (bitrate) parts.push(`${Math.round(bitrate / 1000)} kbps`);
    return parts.join(' ') || 'Quality';
  }
}
