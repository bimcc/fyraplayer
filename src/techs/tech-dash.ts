import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig, DASHSource } from '../types.js';
import * as dashjs from 'dashjs';
import { probeWebCodecs } from '../utils/webcodecs.js';

type DashEventHandler = (event: unknown) => void;

interface DashErrorEventPayload {
  event?: {
    severity?: string;
  };
  error?: string;
}

interface DashMetricBandwidth {
  bandwidth?: number;
}

interface DashRepresentationLike {
  absoluteIndex?: number;
  index?: number;
  id?: string;
  bandwidth?: number;
  width?: number | null;
  height?: number | null;
  codecs?: string;
}

interface DashQualityChangePayload {
  mediaType?: string;
  oldQuality?: number;
  newQuality?: number;
  oldRepresentation?: DashRepresentationLike | null;
  newRepresentation?: DashRepresentationLike | null;
  reason?: string;
}

/**
 * DASH Tech - handles .mpd streams
 * Uses dash.js for MSE-based playback
 */
export class DASHTech extends AbstractTech {
  private dash?: dashjs.MediaPlayerClass;
  private dashErrorHandler?: DashEventHandler;
  private dashLevelHandler?: DashEventHandler;
  private dashReadyHandler?: DashEventHandler;
  private videoLoadedMetadataHandler?: () => void;
  private videoCanPlayHandler?: () => void;
  private readyEmitted = false;

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
    
    await this.setupDash(source, opts.video, opts.webCodecs);
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
        delay: {
          liveDelay: 3
        },
        liveCatchup: {
          enabled: true,
          mode: 'liveCatchupModeDefault'
        }
      }
    });
    
    this.setupDashEventHandlers(video);
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

  private setupDashEventHandlers(video: HTMLVideoElement): void {
    if (!this.dash) return;

    const asDashErrorEvent = (value: unknown): DashErrorEventPayload => {
      if (typeof value !== 'object' || value === null) return {};
      return value as DashErrorEventPayload;
    };
    
    this.dashErrorHandler = (eventPayload: unknown) => {
      const e = asDashErrorEvent(eventPayload);
      const fatal = e?.event?.severity === 'fatal' || e?.error === 'capability';
      if (fatal) {
        this.bus.emit('error', e);
      } else {
        this.bus.emit('network', { type: 'dash-error', details: e });
      }
    };
    
    this.dashLevelHandler = (eventPayload: unknown) => {
      const event = this.asQualityChangePayload(eventPayload);
      const oldRepresentation = event.oldRepresentation ?? null;
      const newRepresentation = event.newRepresentation ?? null;
      this.bus.emit('levelSwitch', {
        tech: 'dash',
        mediaType: event.mediaType,
        from: oldRepresentation?.absoluteIndex ?? oldRepresentation?.index ?? oldRepresentation?.id ?? event.oldQuality ?? null,
        to: newRepresentation?.absoluteIndex ?? newRepresentation?.index ?? newRepresentation?.id ?? event.newQuality ?? null,
        bitrateKbps: newRepresentation?.bandwidth ? Math.round(newRepresentation.bandwidth / 1000) : undefined,
        width: typeof newRepresentation?.width === 'number' ? newRepresentation.width : undefined,
        height: typeof newRepresentation?.height === 'number' ? newRepresentation.height : undefined,
        codec: newRepresentation?.codecs,
        reason: event.reason
      });
    };
    this.dashReadyHandler = () => this.emitReadyOnce();
    this.videoLoadedMetadataHandler = () => this.emitReadyOnce();
    this.videoCanPlayHandler = () => this.emitReadyOnce();
    
    this.dash.on(dashjs.MediaPlayer.events.ERROR, this.dashErrorHandler);
    this.dash.on(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, this.dashLevelHandler);
    this.dash.on(dashjs.MediaPlayer.events.CAN_PLAY, this.dashReadyHandler);
    this.dash.on(dashjs.MediaPlayer.events.PLAYBACK_METADATA_LOADED, this.dashReadyHandler);
    video.addEventListener('loadedmetadata', this.videoLoadedMetadataHandler);
    video.addEventListener('canplay', this.videoCanPlayHandler);
  }

  override getStats() {
    if (this.video && this.dash) {
      const videoWithPlaybackQuality = this.video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { totalVideoFrames?: number };
      };
      const quality = videoWithPlaybackQuality.getVideoPlaybackQuality?.();
      const now = Date.now();
      const metrics = this.dash.getDashMetrics();
      const currentSwitch = metrics?.getCurrentRepresentationSwitch('video') as
        | DashMetricBandwidth
        | undefined;
      const currentRequest = metrics?.getCurrentHttpRequest('video') as
        | DashMetricBandwidth
        | undefined;
      const dashBitrate =
        currentSwitch?.bandwidth ||
        currentRequest?.bandwidth;
      return {
        ts: now,
        fps: this.calculatePlaybackFps(quality?.totalVideoFrames, now),
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
    this.resetPlaybackFpsSampler();
    if (this.dash) {
      if (this.dashErrorHandler) this.dash.off(dashjs.MediaPlayer.events.ERROR, this.dashErrorHandler);
      if (this.dashLevelHandler) this.dash.off(dashjs.MediaPlayer.events.QUALITY_CHANGE_RENDERED, this.dashLevelHandler);
      if (this.dashReadyHandler) {
        this.dash.off(dashjs.MediaPlayer.events.CAN_PLAY, this.dashReadyHandler);
        this.dash.off(dashjs.MediaPlayer.events.PLAYBACK_METADATA_LOADED, this.dashReadyHandler);
      }
      this.dash.reset();
      this.dash = undefined;
    }
    if (this.video) {
      if (this.videoLoadedMetadataHandler) {
        this.video.removeEventListener('loadedmetadata', this.videoLoadedMetadataHandler);
      }
      if (this.videoCanPlayHandler) {
        this.video.removeEventListener('canplay', this.videoCanPlayHandler);
      }
      this.video.src = '';
      this.video.srcObject = null;
      try { this.video.load(); } catch { /* ignore */ }
    }
    this.videoLoadedMetadataHandler = undefined;
    this.videoCanPlayHandler = undefined;
    this.readyEmitted = false;
  }

  private emitReadyOnce(): void {
    if (this.readyEmitted) return;
    this.readyEmitted = true;
    this.bus.emit('ready');
  }

  private asQualityChangePayload(value: unknown): DashQualityChangePayload {
    if (typeof value !== 'object' || value === null) return {};
    return value as DashQualityChangePayload;
  }
}
