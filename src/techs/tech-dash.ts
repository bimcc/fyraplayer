import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig, DASHSource } from '../types.js';
import dashjs from 'dashjs';
import { probeWebCodecs } from '../utils/webcodecs.js';

/**
 * DASH Tech - handles .mpd streams
 * Uses dash.js for MSE-based playback
 */
export class DASHTech extends AbstractTech {
  private dash?: dashjs.MediaPlayerClass;
  private dashErrorHandler?: any;
  private dashLevelHandler?: any;

  canPlay(source: Source): boolean {
    return source.type === 'dash';
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
    
    if (source.type !== 'dash') {
      throw new Error('DASHTech only supports dash source type');
    }
    
    await this.setupDash(source as DASHSource, opts.video, opts.webCodecs);
    this.bus.emit('ready');
  }

  private async setupDash(source: DASHSource, video: HTMLVideoElement, wc?: WebCodecsConfig): Promise<void> {
    this.cleanup();
    
    this.dash = dashjs.MediaPlayer().create();
    
    // Configure ABR settings
    this.dash.updateSettings({
      streaming: {
        abr: {
          limitBitrateByPortal: true
        },
        // Low latency settings if needed
        lowLatencyEnabled: false,
        liveDelay: 3,
        liveCatchup: {
          enabled: true,
          mode: 'liveCatchupModeDefault'
        }
      }
    } as any);
    
    this.setupDashEventHandlers();
    this.dash.initialize(video, source.url, false);
    
    // Check H.265 support for WebCodecs path
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

  private setupDashEventHandlers(): void {
    if (!this.dash) return;
    
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
  }

  override getStats() {
    if (this.video && this.dash) {
      const quality = (this.video as any).getVideoPlaybackQuality?.();
      const dashBitrate =
        (this.dash.getDashMetrics()?.getCurrentRepresentationSwitch('video') as any)?.bandwidth ||
        (this.dash.getDashMetrics()?.getCurrentHttpRequest('video') as any)?.bandwidth;
      return {
        ts: Date.now(),
        fps: quality?.totalVideoFrames,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        bitrateKbps: dashBitrate ? Math.round(dashBitrate / 1000) : undefined
      };
    }
    return super.getStats();
  }

  override async destroy(): Promise<void> {
    this.cleanup();
  }

  private cleanup(): void {
    if (this.dash) {
      if (this.dashErrorHandler) this.dash.off('error', this.dashErrorHandler);
      if (this.dashLevelHandler) this.dash.off('qualityChangeRendered', this.dashLevelHandler);
      this.dash.reset();
      this.dash = undefined;
    }
    if (this.video) {
      this.video.src = '';
      this.video.srcObject = null;
      try { this.video.load(); } catch { /* ignore */ }
    }
  }
}
