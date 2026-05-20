import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebCodecsConfig, DASHSource, QualityState } from '../types.js';
import { probeWebCodecs } from '../utils/webcodecs.js';

type DashEventHandler = (event: unknown) => void;
type DashEvents = {
  ERROR: string;
  QUALITY_CHANGE_RENDERED: string;
  CAN_PLAY: string;
  PLAYBACK_METADATA_LOADED: string;
};

const DEFAULT_DASH_EVENTS: DashEvents = {
  ERROR: 'error',
  QUALITY_CHANGE_RENDERED: 'qualityChangeRendered',
  CAN_PLAY: 'canPlay',
  PLAYBACK_METADATA_LOADED: 'playbackMetaDataLoaded'
};

interface DashErrorEventPayload {
  event?: {
    severity?: string;
  };
  error?: string;
}

interface DashMetricBandwidth {
  bandwidth?: number;
}

export interface DashRepresentationLike {
  absoluteIndex?: number;
  index?: number;
  id?: string;
  bandwidth?: number;
  bitrateInKbit?: number;
  width?: number | null;
  height?: number | null;
  codecs?: string;
}

interface DashMetricsLike {
  getCurrentRepresentationSwitch(type: string): DashMetricBandwidth | undefined;
  getCurrentHttpRequest(type: string): DashMetricBandwidth | undefined;
}

interface DashSettingsLike {
  streaming?: {
    abr?: {
      autoSwitchBitrate?: {
        video?: boolean;
      };
    };
  };
}

interface DashPlayerLike {
  updateSettings(settings: unknown): void;
  initialize(video: HTMLVideoElement, url: string, autoplay: boolean): void;
  on(event: string, handler: DashEventHandler): void;
  off(event: string, handler: DashEventHandler): void;
  reset(): void;
  getDashMetrics(): DashMetricsLike | undefined;
  getRepresentationsByType(type: string): DashRepresentationLike[] | undefined;
  getCurrentRepresentationForType?(type: string): DashRepresentationLike | null;
  getSettings?(): DashSettingsLike;
  setRepresentationForTypeByIndex?(type: string, index: number, forceReplace?: boolean): void;
}

export interface DashJsModuleLike {
  MediaPlayer: {
    (): { create(): DashPlayerLike };
    events: DashEvents;
  };
}

export type DashJsLoader = () =>
  | Promise<DashJsModuleLike | { default?: DashJsModuleLike }>
  | DashJsModuleLike
  | { default?: DashJsModuleLike };

export interface DashTechOptions {
  /** App-provided dash.js loader for host-controlled bundling/loading. */
  dashjsLoader?: DashJsLoader;
  /** Runtime dash.js UMD script URL. Defaults to fyraplayer's packaged vendor file. */
  scriptUrl?: string | false;
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
  private readonly options: DashTechOptions;
  private dash?: DashPlayerLike;
  private dashjs?: DashJsModuleLike;
  private dashErrorHandler?: DashEventHandler;
  private dashLevelHandler?: DashEventHandler;
  private dashReadyHandler?: DashEventHandler;
  private videoLoadedMetadataHandler?: () => void;
  private videoCanPlayHandler?: () => void;
  private readyEmitted = false;

  constructor(options: DashTechOptions = {}) {
    super();
    this.options = options;
  }

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
    
    this.dashjs = await this.loadDashJs();
    this.dash = this.dashjs.MediaPlayer().create();
    
    // Configure ABR settings
    const requestHeaders = source.request?.headers;
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
        },
        ...(requestHeaders
          ? {
              xhr: {
                customHeaders: Object.entries(requestHeaders).map(([name, value]) => ({ name, value }))
              }
            }
          : undefined)
      }
    });
    
    this.setupDashEventHandlers(video, this.dashjs.MediaPlayer.events);
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

  private async loadDashJs(): Promise<DashJsModuleLike> {
    if (this.options.dashjsLoader) {
      return normalizeDashJsModule(await this.options.dashjsLoader());
    }

    const existing = getGlobalDashJs();
    if (existing) {
      return existing;
    }

    if (this.options.scriptUrl === false) {
      throw new Error('dash.js is not available. Provide createDashTechPlugin({ dashjsLoader }) or load window.dashjs before playback.');
    }

    await loadDashJsScript(this.options.scriptUrl ?? getDefaultDashJsScriptUrl());
    const loaded = getGlobalDashJs();
    if (!loaded) {
      throw new Error('dash.js script loaded but window.dashjs was not found.');
    }
    return loaded;
  }

  private setupDashEventHandlers(video: HTMLVideoElement, events: DashEvents = this.dashjs?.MediaPlayer.events ?? DEFAULT_DASH_EVENTS): void {
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
    
    this.dash.on(events.ERROR, this.dashErrorHandler);
    this.dash.on(events.QUALITY_CHANGE_RENDERED, this.dashLevelHandler);
    this.dash.on(events.CAN_PLAY, this.dashReadyHandler);
    this.dash.on(events.PLAYBACK_METADATA_LOADED, this.dashReadyHandler);
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
      const events = this.dashjs?.MediaPlayer.events;
      if (events && this.dashErrorHandler) this.dash.off(events.ERROR, this.dashErrorHandler);
      if (events && this.dashLevelHandler) this.dash.off(events.QUALITY_CHANGE_RENDERED, this.dashLevelHandler);
      if (this.dashReadyHandler) {
        if (events) {
          this.dash.off(events.CAN_PLAY, this.dashReadyHandler);
          this.dash.off(events.PLAYBACK_METADATA_LOADED, this.dashReadyHandler);
        }
      }
      this.dash.reset();
      this.dash = undefined;
    }
    this.dashjs = undefined;
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

  getQualityState(): QualityState {
    const dash = this.dash;
    if (!dash) {
      return { supported: false, tech: 'dash', auto: true, current: null, levels: [] };
    }
    const representations = dash.getRepresentationsByType('video') ?? [];
    const currentRepresentation = dash.getCurrentRepresentationForType?.('video') ?? null;
    const current =
      currentRepresentation?.absoluteIndex ??
      currentRepresentation?.index ??
      currentRepresentation?.id ??
      null;
    const auto = dash.getSettings?.()?.streaming?.abr?.autoSwitchBitrate?.video !== false;

    return {
      supported: true,
      tech: 'dash',
      auto,
      current,
      levels: representations.map((representation, index) => {
        const id = representation.absoluteIndex ?? representation.index ?? representation.id ?? index;
        const bandwidth = representation.bandwidth || (representation.bitrateInKbit ? representation.bitrateInKbit * 1000 : undefined);
        const height = typeof representation.height === 'number' ? representation.height : undefined;
        const width = typeof representation.width === 'number' ? representation.width : undefined;
        return {
          id,
          index,
          label: this.formatQualityLabel(height, bandwidth),
          bitrateKbps: bandwidth ? Math.round(bandwidth / 1000) : undefined,
          width,
          height,
          codec: representation.codecs ?? undefined,
          active: current === id || current === representation.index || current === representation.absoluteIndex
        };
      })
    };
  }

  async setQualityLevel(level: number | string | 'auto'): Promise<void> {
    const dash = this.dash;
    if (!dash) throw new Error('DASH is not loaded');
    if (level === 'auto') {
      dash.updateSettings({
        streaming: {
          abr: {
            autoSwitchBitrate: { video: true }
          }
        }
      });
      return;
    }

    const representations = dash.getRepresentationsByType('video') ?? [];
    const representationIndex = this.findRepresentationIndex(representations, level);
    if (representationIndex < 0) {
      throw new Error(`Invalid DASH quality level: ${level}`);
    }

    dash.updateSettings({
      streaming: {
        abr: {
          autoSwitchBitrate: { video: false }
        }
      }
    });
    dash.setRepresentationForTypeByIndex?.('video', representationIndex, true);
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

  private formatQualityLabel(height?: number, bitrate?: number): string {
    const parts: string[] = [];
    if (height) parts.push(`${height}p`);
    if (bitrate) parts.push(`${Math.round(bitrate / 1000)} kbps`);
    return parts.join(' ') || 'Quality';
  }

  private findRepresentationIndex(representations: DashRepresentationLike[], level: number | string): number {
    const numericLevel = typeof level === 'number' ? level : Number(level);
    if (Number.isInteger(numericLevel) && numericLevel >= 0) {
      const representationIndexMatch = representations.findIndex((representation) =>
        representation.index === numericLevel ||
        representation.absoluteIndex === numericLevel
      );
      if (representationIndexMatch >= 0) return representationIndexMatch;
      if (numericLevel < representations.length) return numericLevel;
    }
    return representations.findIndex((representation) => representation.id === level);
  }
}

function normalizeDashJsModule(moduleLike: DashJsModuleLike | { default?: DashJsModuleLike }): DashJsModuleLike {
  const candidate = 'MediaPlayer' in moduleLike ? moduleLike : moduleLike.default;
  if (!candidate?.MediaPlayer?.events) {
    throw new Error('Invalid dash.js module. Expected a module with MediaPlayer.events.');
  }
  return candidate;
}

function getGlobalDashJs(): DashJsModuleLike | undefined {
  return (globalThis as typeof globalThis & { dashjs?: DashJsModuleLike }).dashjs;
}

function getDefaultDashJsScriptUrl(): string {
  return './vendor/dash.all.min.js';
}

let dashJsScriptPromise: Promise<void> | null = null;

function loadDashJsScript(url: string): Promise<void> {
  if (typeof document === 'undefined') {
    throw new Error('dash.js runtime script loading requires a browser document.');
  }
  if (dashJsScriptPromise) {
    return dashJsScriptPromise;
  }

  dashJsScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-fyraplayer-dashjs="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load dash.js script: ${url}`)), { once: true });
      if (getGlobalDashJs()) resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.fyraplayerDashjs = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load dash.js script: ${url}`)), { once: true });
    document.head.appendChild(script);
  });

  return dashJsScriptPromise;
}
