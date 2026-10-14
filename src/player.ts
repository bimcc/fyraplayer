import { EventBus } from './core/eventBus.js';
import { MiddlewareManager } from './core/middleware.js';
import { TechManager } from './core/techManager.js';
import { PluginManager } from './core/pluginManager.js';
import { enhanceNetworkEvent, isFatalNetworkEvent, type NetworkEventPayload } from './core/networkEvents.js';
import { enhanceQosEvent, type QosEventPayload } from './core/qosEvents.js';
import { WebRTCTech } from './techs/tech-webrtc.js';
import { HLSTech } from './techs/tech-hls.js';
import { FMP4Tech } from './techs/tech-fmp4.js';
import { WSRawTech } from './techs/tech-ws-raw.js';
import { FileTech } from './techs/tech-file.js';
import { Gb28181Tech } from './techs/tech-gb28181.js';
import {
  BufferPolicy,
  DataChannelOptions,
  EngineEvent,
  EngineStats,
  MiddlewareContext,
  PluginContext,
  PlayerAPI,
  PlayerEventHandler,
  PlayerEventMap,
  PlayerOptions,
  PlayerState,
  Source,
  SourceRequestConfig,
  Tech,
  TechRegistrationHandle,
  TechRegistrationOptions,
  TechName,
  QualityState
} from './types.js';
import type { PlaybackSession, PlaybackSessionChange, TechStreamChange } from './types.js';
import { DEFAULT_BUFFER_POLICY, DEFAULT_METRICS_OPTIONS, DEFAULT_RECONNECT_POLICY, DEFAULT_TECH_ORDER } from './core/defaults.js';
import { resolveVideoElement } from './utils/video.js';
import { probeWebCodecs, WebCodecsSupport } from './utils/webcodecs.js';
import { BrowserManagedCodecSupport, probeBrowserManagedCodecs } from './utils/browserCodecs.js';

type EventHandler = (...args: unknown[]) => void;
const MEDIA_HAVE_CURRENT_DATA = 2;

function mergeSourceRequestConfig(
  source: Source,
  headers?: Record<string, string>,
  credentials?: RequestCredentials
): SourceRequestConfig | undefined {
  const existing = source.request;
  if (!existing && !headers && !credentials) return undefined;
  return {
    ...existing,
    ...(headers ? { headers } : undefined),
    ...(credentials ? { credentials } : undefined)
  };
}

export class FyraPlayer implements PlayerAPI {
  private readonly options: PlayerOptions;
  private readonly bus = new EventBus();
  private readonly middleware = new MiddlewareManager();
  private readonly techManager: TechManager;
  private readonly pluginManager: PluginManager;
  private state: PlayerState = 'idle';
  private loadingPromise: Promise<void> | null = null;
  private loadQueue: Promise<void> = Promise.resolve();
  private loadGeneration = 0;
  private loadController: AbortController | null = null;
  private sessionEpoch = 0;
  private session: PlaybackSession | null = null;
  private techEventGeneration = 0;
  private destroyed = false;
  private destroyPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private stopped = false;
  private currentSourceIndex = 0;
  private techOrder: TechName[];
  private bufferPolicy: BufferPolicy | undefined;
  private videoEl: HTMLVideoElement;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectHealthSnapshot: { sourceIndex: number; techName: TechName | null; currentTime: number; readyState: number } | null = null;
  private dataChannelOpts: DataChannelOptions | undefined;
  private techEventHandlers: Map<EngineEvent, EventHandler> = new Map();
  private eventTech: Tech | null = null;
  private readonly videoEventHandlers: Array<{ event: string; handler: EventListener }> = [];

  constructor(opts: PlayerOptions) {
    if (opts.loadTimeoutMs !== undefined && (!Number.isFinite(opts.loadTimeoutMs) || opts.loadTimeoutMs < 0)) {
      throw new RangeError('loadTimeoutMs must be finite and nonnegative');
    }
    this.options = opts;
    this.pluginManager = new PluginManager(opts.onPluginError);
    this.techOrder = opts.techOrder ?? DEFAULT_TECH_ORDER;
    this.bufferPolicy = opts.buffer ?? DEFAULT_BUFFER_POLICY;
    this.videoEl = resolveVideoElement(opts.video);
    
    // Initialize TechManager with shared EventBus for fallback events
    this.techManager = new TechManager(this.bus);
    
    // apply video element knobs
    if (typeof opts.autoplay === 'boolean') this.videoEl.autoplay = opts.autoplay;
    this.videoEl.playsInline = opts.playsInline !== false;
    if (typeof opts.muted === 'boolean') this.videoEl.muted = opts.muted;
    if (opts.preload) this.videoEl.preload = opts.preload;
    this.attachVideoStateEvents();
    this.dataChannelOpts = opts.dataChannel;
    // register middleware
    opts.middleware?.forEach((m) => this.middleware.use(m));
    // register built-in techs
    this.techManager.register('webrtc', new WebRTCTech());
    this.techManager.register('hls', new HLSTech());
    this.techManager.register('fmp4', new FMP4Tech());
    this.techManager.register('ws-raw', new WSRawTech());
    this.techManager.register('gb28181', new Gb28181Tech());
    this.techManager.register('file', new FileTech());

    // plugins
    const pluginCtx: PluginContext = {
      player: this,
      coreBus: this.bus,
      techs: this.createPluginTechRegistry(),
      ui: undefined,
      get storage() {
        try { return globalThis.localStorage; } catch { return undefined; }
      }
    };
    opts.plugins?.forEach((p) => this.pluginManager.register(p));
    this.pluginManager.applyAll(pluginCtx);
  }

  static async probeWebCodecs(): Promise<WebCodecsSupport> {
    return probeWebCodecs();
  }

  static probeBrowserManagedCodecs(): BrowserManagedCodecSupport {
    return probeBrowserManagedCodecs();
  }

  getState(): PlayerState {
    return this.state;
  }

  getSources(): Source[] {
    return this.options.sources;
  }

  getCurrentSource(): Source | undefined {
    return this.options.sources[this.currentSourceIndex];
  }

  getPlaybackSession(): PlaybackSession | null {
    return this.session ? { ...this.session, source: { ...this.session.source }, requestedSource: { ...this.session.requestedSource } } : null;
  }

  private changeSession(reason: PlaybackSessionChange['reason'], session: Omit<PlaybackSession, 'epoch'> | null, reset = true): void {
    if (reset) ++this.sessionEpoch;
    this.session = session ? { ...session, epoch: this.sessionEpoch } : null;
    this.bus.emit('sessionchange', { epoch: this.sessionEpoch, reason, session: this.getPlaybackSession() });
  }

  getVideoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  get currentTime(): number {
    return Number.isFinite(this.videoEl.currentTime) ? this.videoEl.currentTime : 0;
  }

  on<E extends keyof PlayerEventMap>(event: E, handler: PlayerEventHandler<E>): void;
  on(event: string, handler: EventHandler): void;
  on(event: string, handler: EventHandler): void {
    this.bus.on(event, handler);
  }

  once<E extends keyof PlayerEventMap>(event: E, handler: PlayerEventHandler<E>): void;
  once(event: string, handler: EventHandler): void;
  once(event: string, handler: EventHandler): void {
    this.bus.once(event, handler);
  }

  off<E extends keyof PlayerEventMap>(event: E, handler: PlayerEventHandler<E>): void;
  off(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void {
    this.bus.off(event, handler);
  }

  async init(): Promise<void> {
    await this.loadCurrent();
  }

  async switchSource(index: number): Promise<void> {
    this.assertAlive();
    if (index < 0 || index >= this.options.sources.length) {
      throw new Error('source index out of range');
    }
    this.currentSourceIndex = index;
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.techManager.resetFailedTechs();
    this.stopStatsTimer();
    this.detachTechEvents();
    const source = this.getCurrentSource();
    const loading = this.loadCurrent(true, 'switch');
    this.bus.emit('sourcechange', { index, source });
    await loading;
  }

  async play(): Promise<void> {
    this.assertAlive();
    if (this.state === 'loading') return; // Avoid duplicate play during loading
    let generation = this.loadGeneration;
    if (this.state === 'idle' || this.state === 'error') {
      generation = this.loadGeneration + 1;
      const loading = this.loadCurrent();
      await loading;
    }
    const isCurrent = () => !this.destroyed && !this.stopped && generation === this.loadGeneration;
    if (!isCurrent()) return;
    await this.middleware.run('control', { source: this.getCurrentSource()!, tech: this.techManager.getCurrentTechName() ?? this.techOrder[0], action: 'play' });
    if (!isCurrent()) return;
    const tech = this.techManager.getCurrentTech();
    if (!tech) {
      generation = this.loadGeneration + 1;
      const loading = this.loadCurrent();
      await loading;
      if (!isCurrent()) return;
    }
    const activeGeneration = this.loadGeneration;
    try {
      await this.techManager.getCurrentTech()?.play();
      if (this.destroyed || this.stopped || activeGeneration !== this.loadGeneration) return;
      if (this.videoEl.paused) {
        try {
          await this.videoEl.play();
        } catch (err) {
          if (!this.destroyed && !this.stopped && activeGeneration === this.loadGeneration) this.reportPlayError(err);
        }
      }
    } catch (e) {
      if (this.destroyed || activeGeneration !== this.loadGeneration) return;
      if (this.reportPlayError(e)) return;
      await this.handleReconnect();
    }
  }

  /** Browser gesture policy is recoverable by a tap; it must not reload the transport. */
  private reportPlayError(error: unknown): boolean {
    if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError') {
      this.state = 'paused';
      this.bus.emit('network', enhanceNetworkEvent({type:'autoplay-blocked',severity:'warning',error}));
      return true;
    }
    this.bus.emit('error', error);
    return false;
  }

  async pause(): Promise<void> {
    this.assertAlive();
    if (this.state === 'loading' || this.reconnectTimer || this.state === 'error') {
      await this.stop();
      return;
    }
    const generation = this.loadGeneration;
    await this.middleware.run('control', { source: this.getCurrentSource()!, tech: this.techManager.getCurrentTechName() ?? this.techOrder[0], action: 'pause' });
    if (this.destroyed || generation !== this.loadGeneration) return;
    const tech = this.techManager.getCurrentTech();
    if (!tech) return;
    try {
      await tech.pause();
      if (this.destroyed || generation !== this.loadGeneration) return;
      this.state = 'paused';
      this.bus.emit('pause');
    } catch (e) {
      if (!this.destroyed && generation === this.loadGeneration) this.bus.emit('error', e);
    }
  }

  /** Stop recovery immediately, then serialize resource release with the old load. */
  stop(): Promise<void> {
    this.assertAlive();
    if (this.stopPromise && this.stopped) return this.stopPromise;
    this.stopped = true;
    const generation = ++this.loadGeneration;
    this.stopStatsTimer();
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.techManager.resetFailedTechs();
    this.detachTechEvents();
    this.state = 'idle';
    const controller = this.loadController;
    this.loadController = null;
    this.loadingPromise = null;
    try { this.videoEl.pause?.(); } catch { /* already detached */ }
    const stopping = this.loadQueue.then(async () => {
      await this.techManager.destroyCurrent();
      if (this.destroyed || generation !== this.loadGeneration) return;
      this.videoEl.srcObject = null;
      this.videoEl.removeAttribute?.('src');
      try { this.videoEl.load(); } catch { /* already detached */ }
    });
    this.loadQueue = stopping.catch(() => {});
    this.stopPromise = stopping;
    void stopping.then(() => {
      if (this.stopPromise === stopping) this.stopPromise = null;
    }, () => {
      if (this.stopPromise === stopping) this.stopPromise = null;
    });
    controller?.abort();
    if (!this.destroyed && generation === this.loadGeneration) this.changeSession('stop', null);
    if (!this.destroyed && generation === this.loadGeneration) this.bus.emit('stop');
    return stopping;
  }

  async seek(time: number): Promise<void> {
    this.assertAlive();
    const generation = this.loadGeneration;
    await this.middleware.run('control', { source: this.getCurrentSource()!, tech: this.techManager.getCurrentTechName() ?? this.techOrder[0], action: 'seek', payload: time });
    if (this.destroyed || generation !== this.loadGeneration) return;
    const tech = this.techManager.getCurrentTech();
    if (tech) {
      await tech.seek(time);
      if (!this.destroyed && generation === this.loadGeneration) this.bus.emit('seek', { time });
    }
  }

  getQualityState(): QualityState {
    const tech = this.techManager.getCurrentTech();
    const techName = this.techManager.getCurrentTechName() ?? undefined;
    if (!tech?.getQualityState) {
      return { supported: false, tech: techName, auto: true, current: null, levels: [] };
    }
    return {
      tech: techName,
      ...tech.getQualityState()
    };
  }

  async setQualityLevel(level: number | string | 'auto'): Promise<void> {
    this.assertAlive();
    const generation = this.loadGeneration;
    const tech = this.techManager.getCurrentTech();
    if (!tech?.setQualityLevel) {
      throw new Error('Current tech does not support quality selection');
    }
    await this.middleware.run('control', {
      source: this.getCurrentSource()!,
      tech: this.techManager.getCurrentTechName() ?? this.techOrder[0],
      action: 'quality',
      payload: level
    });
    if (!this.destroyed && generation === this.loadGeneration) await tech.setQualityLevel(level);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectHealthSnapshot = null;
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyed = true;
    ++this.loadGeneration;
    this.stopStatsTimer();
    this.clearReconnectTimer();
    this.detachTechEvents();
    this.detachVideoStateEvents();
    this.state = 'idle';
    this.destroyPromise = (async () => {
      // Serialize teardown with Tech.load(): an old load cannot allocate
      // resources after final cleanup, or race a new load on the same Tech.
      await this.loadQueue;
      try {
        await this.techManager.destroyCurrent();
      } finally {
        await this.pluginManager.unregisterAll();
        this.bus.removeAllListeners();
        try {
          this.videoEl.src = '';
          this.videoEl.srcObject = null;
          this.videoEl.load();
        } catch { /* already detached */ }
        this.reconnectAttempts = 0;
        this.state = 'idle';
      }
    })();
    this.pluginManager.deactivateAll();
    this.loadController?.abort();
    this.changeSession('destroy', null);
    return this.destroyPromise;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('Player has been destroyed; create a new instance');
  }

  private attachVideoStateEvents(): void {
    const add = (event: string, handler: EventListener) => {
      this.videoEl.addEventListener?.(event, handler);
      this.videoEventHandlers.push({ event, handler });
    };
    const markPlaying = () => {
      if (this.stopped || this.destroyed) return;
      if (this.state !== 'loading' && this.state !== 'error') {
        this.state = 'playing';
      }
    };
    add('play', markPlaying);
    add('playing', markPlaying);
    add('pause', () => {
      if (this.state === 'playing') this.state = 'paused';
    });
    add('ended', () => {
      if (this.stopped || this.destroyed) return;
      this.state = 'ended';
    });
  }

  private detachVideoStateEvents(): void {
    for (const { event, handler } of this.videoEventHandlers) {
      this.videoEl.removeEventListener?.(event, handler);
    }
    this.videoEventHandlers.length = 0;
  }

  /**
   * Invoke a tech-specific control action, passing through control middleware.
   * Useful for GB28181 (invite/bye/ptz/query) and future techs.
   */
  async control(action: string, payload?: unknown): Promise<unknown> {
    this.assertAlive();
    const generation = this.loadGeneration;
    const source = this.getCurrentSource();
    if (!source) throw new Error('no source available');
    const techName = this.techManager.getCurrentTechName() ?? this.techOrder[0];
    await this.middleware.run('control', { source, tech: techName, action, payload });
    if (this.destroyed || generation !== this.loadGeneration) return undefined;
    const tech = this.techManager.getCurrentTech();
    if (tech?.invoke) {
      return tech.invoke(action, payload);
    }
    throw new Error(`Current tech does not support control action: ${action}`);
  }

  private createPluginTechRegistry() {
    return {
      getCurrentTech: () => this.techManager.getCurrentTech(),
      getTech: (name: TechName) => this.techManager.getTech(name),
      getCurrentTechName: () => this.techManager.getCurrentTechName(),
      getRegisteredTechs: () => this.techManager.getRegisteredTechs(),
      register: (name: TechName, tech: Tech, options?: TechRegistrationOptions): TechRegistrationHandle =>
        this.registerPluginTech(name, tech, options)
    };
  }

  private registerPluginTech(name: TechName, tech: Tech, options: TechRegistrationOptions = {}): TechRegistrationHandle {
    const registeredBefore = this.techManager.getRegisteredTechs().includes(name);
    const previousTech = this.techManager.getTech(name);
    const previousTechOrder = [...this.techOrder];
    if (registeredBefore && !options.replace) {
      throw new Error(`Tech already registered: ${name}`);
    }

    if (registeredBefore) {
      this.techManager.replace(name, tech);
    } else {
      this.techManager.register(name, tech);
    }

    this.applyPluginTechOrder(name, options.techOrder, registeredBefore);
    let active = true;
    return {
      name,
      unregister: async () => {
        if (!active) return;
        active = false;
        this.detachTechEvents();
        if (registeredBefore && previousTech) {
          if (this.techManager.getCurrentTechName() === name) {
            await this.techManager.destroyCurrent();
          }
          this.techOrder = previousTechOrder;
          this.techManager.replace(name, previousTech);
          return;
        }
        this.techOrder = this.techOrder.filter((techName) => techName !== name);
        await this.techManager.unregister(name);
      }
    };
  }

  private applyPluginTechOrder(name: TechName, option: TechRegistrationOptions['techOrder'], registeredBefore: boolean): void {
    if (option === false) return;
    if (option === undefined && registeredBefore) return;
    const mode = option ?? 'append';
    this.techOrder = this.techOrder.filter((techName) => techName !== name);
    if (mode === 'prepend') {
      this.techOrder = [name, ...this.techOrder];
      return;
    }
    this.techOrder = [...this.techOrder, name];
  }

  private async loadCurrent(replace = false, reason: 'load' | 'switch' | 'reconnect' = 'load'): Promise<void> {
    this.assertAlive();
    const requestedSource = this.getCurrentSource();
    if (!requestedSource) throw new Error('no source available');
    
    // Prevent concurrent loading - wait for existing load to complete
    if (this.loadingPromise && !replace) {
      return this.loadingPromise;
    }
    
    this.state = 'loading';
    this.stopped = false;
    const generation = ++this.loadGeneration;
    const previousController = this.loadController;
    const controller = new AbortController();
    this.loadController = controller;
    const isCurrent = () => !this.destroyed && generation === this.loadGeneration;
    this.stopStatsTimer();
    this.detachTechEvents();
    
    // Create a new promise and store reference before async operations
    const loadPromise = this.loadQueue.then(async () => {
      if (!isCurrent()) return;
      let source = requestedSource;
      try {
        // Requirements 6.1, 6.2: Handle Auto Source resolution
        if (source.type === 'auto') {
          const resolveCtx: MiddlewareContext = {
            signal: controller.signal,
            source,
            tech: source.preferTech ?? this.techOrder[0],
            url: source.url
          };
        
          // Run resolve middleware to get resolved sources
          const resolvedCtx = await this.middleware.run('resolve', resolveCtx, this.options.loadTimeoutMs);
          if (!isCurrent()) return;
        
          // Requirements 6.4: Emit error if no adapter resolved the source
          if (!resolvedCtx.resolvedSources) {
            const engine = source.engine ?? 'unknown';
            throw new Error(`No adapter registered for engine: ${engine}`);
          }
        
          // Use resolved primary source with fallbacks
          source = {
            ...resolvedCtx.resolvedSources.primary,
            fallbacks: resolvedCtx.resolvedSources.fallbacks
          };
        }
      
        const middlewareCtx: MiddlewareContext = {
          signal: controller.signal,
          source,
          tech: source.preferTech ?? this.techOrder[0],
          url: source.url
        };
        // run request middleware once before load
        const requestCtx = await this.middleware.run('request', middlewareCtx, this.options.loadTimeoutMs);
        if (!isCurrent()) return;
        // apply middleware modifications
        const requestSource = requestCtx.source as Source;
        const requestConfig = mergeSourceRequestConfig(requestSource, requestCtx.headers, requestCtx.credentials);
        const patchedSource = {
          ...requestSource,
          url: requestCtx.url ?? requestCtx.source.url ?? source.url,
          ...(requestConfig ? { request: requestConfig } : undefined)
        } as Source;
        // run signal middleware (best-effort) before load
        const signalCtx = await this.middleware.run('signal', {
          ...requestCtx,
          source: patchedSource,
          tech: patchedSource.preferTech ?? this.techOrder[0],
          url: patchedSource.url
        }, this.options.loadTimeoutMs);
        if (!isCurrent()) return;
        const signalSource = signalCtx.source as Source;
        const signalRequestConfig = mergeSourceRequestConfig(signalSource, signalCtx.headers, signalCtx.credentials);
        const finalSource = {
          ...signalSource,
          url: signalCtx.url ?? signalCtx.source.url ?? patchedSource.url,
          ...(signalRequestConfig ? { request: signalRequestConfig } : undefined)
        } as Source;
        const loaded = await this.techManager.selectAndLoad([finalSource], this.techOrder, {
          buffer: this.bufferPolicy,
          reconnect: this.options.reconnect ?? DEFAULT_RECONNECT_POLICY,
          metrics: this.options.metrics ?? DEFAULT_METRICS_OPTIONS,
          video: this.videoEl,
          webCodecs: this.options.webCodecs,
          dataChannel: this.dataChannelOpts,
          mpegtsLoader: this.options.mpegtsLoader,
          shouldContinue: isCurrent,
          signal: controller.signal,
          loadTimeoutMs: this.options.loadTimeoutMs,
          onTechWillLoad: (techName, _tech, actualSource, signal) => {
            this.attachTechEvents(techName, signal);
            this.changeSession('selected', { source: actualSource, requestedSource, tech: techName, status: 'loading' });
          },
          onTechLoadFailed: () => {
            if (!isCurrent()) return;
            this.detachTechEvents();
            this.changeSession('failed', null);
          },
        });
        if (!isCurrent()) return;
        if (!loaded) {
          throw new Error('No compatible tech/source');
        }
        if (this.session) this.changeSession('loaded', { ...this.session, status: 'loaded' }, false);
        if (!isCurrent()) return;
        this.startStatsTimer();
      } catch (e) {
        if (!isCurrent()) return;
        this.state = 'error';
        this.changeSession('failed', null);
        if (!isCurrent()) return;
        this.bus.emit('error', e);
        await this.handleReconnect();
      }
    });
    this.loadQueue = loadPromise.catch(() => {});
    
    // Store promise reference and ensure cleanup on completion
    this.loadingPromise = loadPromise;
    // Queue is installed before synchronous observers can re-enter switch/destroy.
    previousController?.abort();
    if (isCurrent()) this.changeSession(reason, null);
    
    try {
      await loadPromise;
    } finally {
      // Only clear if this is still the current loading promise
      if (this.loadingPromise === loadPromise) {
        this.loadingPromise = null;
      }
    }
  }

  private attachTechEvents(name: TechName, signal?: AbortSignal): void {
    const tech = this.techManager.getCurrentTech();
    if (!tech) return;
    
    // Clean up previous handlers to prevent memory leaks
    this.detachTechEvents();
    this.eventTech = tech;
    const generation = this.loadGeneration;
    const eventGeneration = this.techEventGeneration;
    const isCurrent = () => !this.destroyed && !signal?.aborted && generation === this.loadGeneration
      && eventGeneration === this.techEventGeneration && this.eventTech === tech;
    
    const forward = (event: EngineEvent, transform?: (args: unknown[]) => unknown[]) => {
      const handler = (...args: unknown[]) => {
        if (!isCurrent()) return;
        const payload = transform ? transform(args) : args;
        const payloadArray = Array.isArray(payload) ? payload : [payload];
        this.bus.emit(event, ...payloadArray);
        if (!isCurrent()) return;
        if (event === 'ready') {
          this.state = 'ready';
          this.reconnectAttempts = 0;
          this.clearReconnectTimer();
          this.techManager.resetFailedTechs();
          if (this.options.autoplay) {
            this.play().catch(() => {
              /* ignore autoplay rejection */
            });
          }
        }
        if (event === 'ended') this.state = 'ended';
        if (event === 'error') this.state = 'error';
      };
      this.techEventHandlers.set(event, handler);
      tech.on(event, handler);
    };
    forward('ready');
    forward('play', () => {
      this.state = 'playing';
      return [];
    });
    forward('pause', () => {
      this.state = 'paused';
      return [];
    });
    forward('ended');
    forward('error');
    forward('buffer');
    forward('tracks');
    forward('levelSwitch');
    forward('stats', (args) => {
      const stats = args[0] as EngineStats | undefined;
      return [{ tech: name, stats }];
    });
    forward('qos', (args) => {
      const evt = args?.[0] as QosEventPayload | undefined;
      return [enhanceQosEvent(evt, name)];
    });
    forward('sei');
    forward('data');
    forward('metadata');
    const streamHandler = (value: unknown) => {
      if (!isCurrent() || !this.session) return;
      const event = value as TechStreamChange;
      if (event?.reason !== 'fallback' && event?.reason !== 'discontinuity') return;
      this.changeSession(event.reason, { ...this.session, source: event.source ?? this.session.source });
    };
    this.techEventHandlers.set('streamchange', streamHandler);
    tech.on('streamchange', streamHandler);
    const networkHandler = (...args: unknown[]) => {
      if (!isCurrent()) return;
      const evt = args?.[0] as NetworkEventPayload | undefined;
      const enhancedEvt = enhanceNetworkEvent(evt);
      this.bus.emit('network', enhancedEvt);
      if (!isCurrent()) return;

      // 仅在明确 fatal/断线事件时触发重连，避免正常抖动导致重置
      // Only treat explicitly fatal or hard failures as fatal. Transient 'disconnected' should not trigger fallback.
      if (isFatalNetworkEvent(evt)) {
        void this.handleReconnect();
      }
    };
    this.techEventHandlers.set('network', networkHandler);
    tech.on('network', networkHandler);
  }

  private detachTechEvents(): void {
    ++this.techEventGeneration;
    const tech = this.eventTech;
    if (tech?.off) {
      for (const [event, handler] of this.techEventHandlers.entries()) {
        try {
          tech.off(event, handler);
        } catch {
          /* ignore */
        }
      }
    }
    this.techEventHandlers.clear();
    this.eventTech = null;
  }

  private startStatsTimer(): void {
    if (this.destroyed) return;
    if (this.statsTimer) clearInterval(this.statsTimer);
    const interval = (this.options.metrics?.statsIntervalMs ?? DEFAULT_METRICS_OPTIONS.statsIntervalMs) || 1000;
    this.statsTimer = setInterval(() => {
      const tech = this.techManager.getCurrentTech();
      if (!tech) return;
      const stats = tech.getStats();
      this.bus.emit('stats', { tech: this.techManager.getCurrentTechName(), stats });
    }, interval);
  }

  private stopStatsTimer(): void {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
  }

  private async handleReconnect(): Promise<void> {
    if (this.destroyed || this.stopped) return;
    const generation = this.loadGeneration;
    const reconnect = this.options.reconnect ?? DEFAULT_RECONNECT_POLICY;
    if (!reconnect.enabled) return;
    if (this.reconnectTimer) return;
    const maxRetries = reconnect.maxRetries ?? 3;
    if (this.reconnectAttempts >= maxRetries) {
      this.bus.emit('network', enhanceNetworkEvent({
        type: 'reconnect-exhausted',
        attempt: this.reconnectAttempts,
        maxRetries,
        fatal: true
      }));
      if (this.destroyed || generation !== this.loadGeneration) return;
      this.state = 'error';
      this.detachTechEvents();
      this.stopStatsTimer();
      this.changeSession('failed', null);
      if (this.destroyed || generation !== this.loadGeneration) return;
      try {
        await this.techManager.destroyCurrent();
      } catch {
        /* ignore */
      }
      return;
    }
    this.reconnectAttempts += 1;
    
    // Requirements 7.5: Emit reconnect event with attempt count
    this.bus.emit('network', enhanceNetworkEvent({
      type: 'reconnect', 
      attempt: this.reconnectAttempts,
      maxRetries
    }));
    if (this.destroyed || generation !== this.loadGeneration) return;
    this.reconnectHealthSnapshot = {
      sourceIndex: this.currentSourceIndex,
      techName: this.techManager.getCurrentTechName(),
      currentTime: this.currentTime,
      readyState: this.videoEl.readyState
    };
    
    const delay =
      Math.min((reconnect.baseDelayMs ?? 1000) * Math.pow(2, this.reconnectAttempts - 1), reconnect.maxDelayMs ?? 8000) *
      (1 + (reconnect.jitter ?? 0));
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.destroyed || this.stopped || generation !== this.loadGeneration) return;
      try {
        if (this.isPlaybackHealthySinceReconnectScheduled()) {
          this.reconnectHealthSnapshot = null;
          this.reconnectAttempts = 0;
          this.techManager.resetFailedTechs();
          this.state = this.videoEl.paused ? 'ready' : 'playing';
          return;
        }
        this.reconnectHealthSnapshot = null;
        this.techManager.resetFailedTechs();
        await this.loadCurrent(false, 'reconnect');
      } catch (e) {
        this.bus.emit('error', e);
      }
    }, delay);
  }

  private isPlaybackHealthySinceReconnectScheduled(): boolean {
    const snapshot = this.reconnectHealthSnapshot;
    if (!snapshot) return false;
    if (snapshot.sourceIndex !== this.currentSourceIndex) return false;
    if (snapshot.techName !== this.techManager.getCurrentTechName()) return false;
    // WebRTC already waits for ICE recovery before requesting a reload. A disconnected
    // MediaStream can keep its clock running and readyState high without new frames.
    if (snapshot.techName === 'webrtc') return false;
    if (this.videoEl.readyState < MEDIA_HAVE_CURRENT_DATA) return false;
    if (this.videoEl.error) return false;
    const advanced = this.currentTime > snapshot.currentTime + 0.25;
    const becameReady = snapshot.readyState < MEDIA_HAVE_CURRENT_DATA && this.videoEl.readyState >= MEDIA_HAVE_CURRENT_DATA;
    return advanced || becameReady;
  }

  // ============================================================================
  // Metadata Extraction API (for ws-raw tech with detectOnly mode)
  // ============================================================================

  /**
   * Enable metadata extraction after detection.
   * Call this after receiving 'metadata' events with type 'private-data-detected' or 'sei-detected'
   * to start actual extraction of the detected metadata.
   * 
   * Only works when using ws-raw tech with metadata.privateData.detectOnly or metadata.sei.detectOnly enabled.
   */
  enableMetadataExtraction(): void {
    const tech = this.techManager.getCurrentTech();
    const techName = this.techManager.getCurrentTechName();
    
    if (techName !== 'ws-raw' || !tech) {
      console.warn('[player] enableMetadataExtraction() only works with ws-raw tech');
      return;
    }
    
    // Type assertion since we know it's WSRawTech
    const wsRawTech = tech as import('./techs/tech-ws-raw.js').WSRawTech;
    if (typeof wsRawTech.enableMetadataExtraction === 'function') {
      wsRawTech.enableMetadataExtraction();
    }
  }

  /**
   * Disable metadata extraction.
   * Stops extracting metadata while still detecting new PIDs/SEI types.
   */
  disableMetadataExtraction(): void {
    const tech = this.techManager.getCurrentTech();
    const techName = this.techManager.getCurrentTechName();
    
    if (techName !== 'ws-raw' || !tech) {
      console.warn('[player] disableMetadataExtraction() only works with ws-raw tech');
      return;
    }
    
    const wsRawTech = tech as import('./techs/tech-ws-raw.js').WSRawTech;
    if (typeof wsRawTech.disableMetadataExtraction === 'function') {
      wsRawTech.disableMetadataExtraction();
    }
  }

  /**
   * Get detected private data PIDs.
   * Returns an array of PIDs that have been detected in the stream.
   */
  getDetectedPrivateDataPids(): number[] {
    const tech = this.techManager.getCurrentTech();
    const techName = this.techManager.getCurrentTechName();
    
    if (techName !== 'ws-raw' || !tech) {
      return [];
    }
    
    const wsRawTech = tech as import('./techs/tech-ws-raw.js').WSRawTech;
    if (typeof wsRawTech.getDetectedPrivateDataPids === 'function') {
      return wsRawTech.getDetectedPrivateDataPids();
    }
    return [];
  }

  /**
   * Get detected SEI types.
   * Returns an array of SEI payload type numbers that have been detected.
   */
  getDetectedSeiTypes(): number[] {
    const tech = this.techManager.getCurrentTech();
    const techName = this.techManager.getCurrentTechName();
    
    if (techName !== 'ws-raw' || !tech) {
      return [];
    }
    
    const wsRawTech = tech as import('./techs/tech-ws-raw.js').WSRawTech;
    if (typeof wsRawTech.getDetectedSeiTypes === 'function') {
      return wsRawTech.getDetectedSeiTypes();
    }
    return [];
  }
}
