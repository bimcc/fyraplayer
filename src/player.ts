import { EventBus } from './core/eventBus.js';
import { MiddlewareManager } from './core/middleware.js';
import { TechManager } from './core/techManager.js';
import { PluginManager } from './core/pluginManager.js';
import { enhanceNetworkEvent, isFatalNetworkEvent, type NetworkEventPayload } from './core/networkEvents.js';
import { enhanceQosEvent, type QosEventPayload } from './core/qosEvents.js';
import { WebRTCTech } from './techs/tech-webrtc.js';
import { HLSTech } from './techs/tech-hls.js';
import { DASHTech } from './techs/tech-dash.js';
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
  Tech,
  TechRegistrationHandle,
  TechRegistrationOptions,
  TechName
} from './types.js';
import { DEFAULT_BUFFER_POLICY, DEFAULT_METRICS_OPTIONS, DEFAULT_RECONNECT_POLICY, DEFAULT_TECH_ORDER } from './core/defaults.js';
import { resolveVideoElement } from './utils/video.js';
import { probeWebCodecs, WebCodecsSupport } from './utils/webcodecs.js';

type EventHandler = (...args: unknown[]) => void;

export class FyraPlayer implements PlayerAPI {
  private readonly options: PlayerOptions;
  private readonly bus = new EventBus();
  private readonly middleware = new MiddlewareManager();
  private readonly techManager: TechManager;
  private readonly pluginManager = new PluginManager();
  private state: PlayerState = 'idle';
  private loadingPromise: Promise<void> | null = null;
  private currentSourceIndex = 0;
  private techOrder: TechName[];
  private bufferPolicy: BufferPolicy | undefined;
  private videoEl: HTMLVideoElement;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private dataChannelOpts: DataChannelOptions | undefined;
  private techEventHandlers: Map<EngineEvent, EventHandler> = new Map();

  constructor(opts: PlayerOptions) {
    this.options = opts;
    this.techOrder = opts.techOrder ?? DEFAULT_TECH_ORDER;
    this.bufferPolicy = opts.buffer ?? DEFAULT_BUFFER_POLICY;
    this.videoEl = resolveVideoElement(opts.video);
    
    // Initialize TechManager with shared EventBus for fallback events
    this.techManager = new TechManager(this.bus);
    
    // apply video element knobs
    if (typeof opts.autoplay === 'boolean') this.videoEl.autoplay = opts.autoplay;
    if (typeof opts.muted === 'boolean') this.videoEl.muted = opts.muted;
    if (opts.preload) this.videoEl.preload = opts.preload;
    this.dataChannelOpts = opts.dataChannel;
    // register middleware
    opts.middleware?.forEach((m) => this.middleware.use(m));
    // register built-in techs
    this.techManager.register('webrtc', new WebRTCTech());
    this.techManager.register('hls', new HLSTech());
    this.techManager.register('dash', new DASHTech());
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
      storage: window?.localStorage
    };
    opts.plugins?.forEach((p) => this.pluginManager.register(p));
    this.pluginManager.applyAll(pluginCtx);
  }

  static async probeWebCodecs(): Promise<WebCodecsSupport> {
    return probeWebCodecs();
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
    if (index < 0 || index >= this.options.sources.length) {
      throw new Error('source index out of range');
    }
    this.currentSourceIndex = index;
    this.reconnectAttempts = 0;
    this.techManager.resetFailedTechs();
    this.detachTechEvents();
    await this.techManager.destroyCurrent();
    await this.loadCurrent();
  }

  async play(): Promise<void> {
    if (this.state === 'loading') return; // Avoid duplicate play during loading
    if (this.state === 'idle') {
      await this.loadCurrent();
    }
    await this.middleware.run('control', { source: this.getCurrentSource()!, tech: this.techManager.getCurrentTechName() ?? this.techOrder[0], action: 'play' });
    const tech = this.techManager.getCurrentTech();
    if (!tech) {
      await this.loadCurrent();
    }
    try {
      await this.techManager.getCurrentTech()?.play();
      if (this.videoEl.paused) {
        try {
          await this.videoEl.play();
        } catch (err) {
          this.bus.emit('error', err);
        }
      }
    } catch (e) {
      this.bus.emit('error', e);
      await this.handleReconnect();
    }
  }

  async pause(): Promise<void> {
    await this.middleware.run('control', { source: this.getCurrentSource()!, tech: this.techManager.getCurrentTechName() ?? this.techOrder[0], action: 'pause' });
    const tech = this.techManager.getCurrentTech();
    if (!tech) return;
    try {
      await tech.pause();
      this.state = 'paused';
      this.bus.emit('pause');
    } catch (e) {
      this.bus.emit('error', e);
    }
  }

  async seek(time: number): Promise<void> {
    await this.middleware.run('control', { source: this.getCurrentSource()!, tech: this.techManager.getCurrentTechName() ?? this.techOrder[0], action: 'seek', payload: time });
    const tech = this.techManager.getCurrentTech();
    if (tech) {
      await tech.seek(time);
    }
  }

  async destroy(): Promise<void> {
    this.stopStatsTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.detachTechEvents();
    await this.techManager.destroyCurrent();
    try {
      await this.pluginManager.unregisterAll();
    } catch (err) {
      console.warn('[player] plugin cleanup error', err);
    }
    this.bus.removeAllListeners();
    try {
      this.videoEl.src = '';
      this.videoEl.srcObject = null;
      this.videoEl.load();
    } catch {
      /* ignore */
    }
    this.reconnectAttempts = 0;
    this.state = 'idle';
  }

  /**
   * Invoke a tech-specific control action, passing through control middleware.
   * Useful for GB28181 (invite/bye/ptz/query) and future techs.
   */
  async control(action: string, payload?: unknown): Promise<unknown> {
    const source = this.getCurrentSource();
    if (!source) throw new Error('no source available');
    const techName = this.techManager.getCurrentTechName() ?? this.techOrder[0];
    await this.middleware.run('control', { source, tech: techName, action, payload });
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

  private async loadCurrent(): Promise<void> {
    let source = this.getCurrentSource();
    if (!source) throw new Error('no source available');
    
    // Prevent concurrent loading - wait for existing load to complete
    if (this.loadingPromise) {
      return this.loadingPromise;
    }
    
    this.state = 'loading';
    
    // Create a new promise and store reference before async operations
    const loadPromise = (async () => {
      // Requirements 6.1, 6.2: Handle Auto Source resolution
      if (source.type === 'auto') {
        const resolveCtx: MiddlewareContext = {
          source,
          tech: source.preferTech ?? this.techOrder[0],
          url: source.url
        };
        
        // Run resolve middleware to get resolved sources
        const resolvedCtx = await this.middleware.run('resolve', resolveCtx);
        
        // Requirements 6.4: Emit error if no adapter resolved the source
        if (!resolvedCtx.resolvedSources) {
          const engine = source.engine ?? 'unknown';
          const err = new Error(`No adapter registered for engine: ${engine}`);
          this.bus.emit('error', err);
          this.state = 'error';
          this.loadingPromise = null;
          return;
        }
        
        // Use resolved primary source with fallbacks
        source = {
          ...resolvedCtx.resolvedSources.primary,
          fallbacks: resolvedCtx.resolvedSources.fallbacks
        };
      }
      
      const middlewareCtx: MiddlewareContext = {
        source,
        tech: source.preferTech ?? this.techOrder[0],
        url: source.url
      };
      // run request middleware once before load
      const requestCtx = await this.middleware.run('request', middlewareCtx);
      // apply middleware modifications
      const patchedSource = {
        ...(requestCtx.source as Source),
        url: requestCtx.url ?? requestCtx.source.url ?? source.url
      } as Source;
      // run signal middleware (best-effort) before load
      const signalCtx = await this.middleware.run('signal', {
        ...requestCtx,
        source: patchedSource,
        tech: patchedSource.preferTech ?? this.techOrder[0],
        url: patchedSource.url
      });
      const finalSource = {
        ...(signalCtx.source as Source),
        url: signalCtx.url ?? signalCtx.source.url ?? patchedSource.url
      } as Source;
      try {
        const loaded = await this.techManager.selectAndLoad([finalSource], this.techOrder, {
          buffer: this.bufferPolicy,
          reconnect: this.options.reconnect ?? DEFAULT_RECONNECT_POLICY,
          metrics: this.options.metrics ?? DEFAULT_METRICS_OPTIONS,
          video: this.videoEl,
          webCodecs: this.options.webCodecs,
          dataChannel: this.dataChannelOpts,
          onTechWillLoad: (techName) => {
            this.attachTechEvents(techName);
          }
        });
        if (!loaded) {
          throw new Error('No compatible tech/source');
        }
        this.startStatsTimer();
      } catch (e) {
        this.state = 'error';
        this.bus.emit('error', e);
        await this.handleReconnect();
      }
    })();
    
    // Store promise reference and ensure cleanup on completion
    this.loadingPromise = loadPromise;
    
    try {
      await loadPromise;
    } finally {
      // Only clear if this is still the current loading promise
      if (this.loadingPromise === loadPromise) {
        this.loadingPromise = null;
      }
    }
  }

  private attachTechEvents(name: TechName): void {
    const tech = this.techManager.getCurrentTech();
    if (!tech) return;
    
    // Clean up previous handlers to prevent memory leaks
    this.detachTechEvents();
    
    const forward = (event: EngineEvent, transform?: (args: unknown[]) => unknown[]) => {
      const handler = (...args: unknown[]) => {
        const payload = transform ? transform(args) : args;
        const payloadArray = Array.isArray(payload) ? payload : [payload];
        this.bus.emit(event, ...payloadArray);
        if (event === 'ready') {
          this.state = 'ready';
          this.reconnectAttempts = 0;
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
    const networkHandler = (...args: unknown[]) => {
      const evt = args?.[0] as NetworkEventPayload | undefined;
      const enhancedEvt = enhanceNetworkEvent(evt);
      this.bus.emit('network', enhancedEvt);

      // 仅在明确 fatal/断线事件时触发重连，避免正常抖动导致重置
      // Only treat explicitly fatal or hard failures as fatal. Transient 'disconnected' should not trigger fallback.
      if (isFatalNetworkEvent(evt)) {
        const currentTech = this.techManager.getCurrentTechName();
        if (currentTech) this.techManager.markTechFailed(currentTech);
        void this.handleReconnect();
      }
    };
    this.techEventHandlers.set('network', networkHandler);
    tech.on('network', networkHandler);
  }

  private detachTechEvents(): void {
    const tech = this.techManager.getCurrentTech();
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
  }

  private startStatsTimer(): void {
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
      this.state = 'error';
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
    
    const delay =
      Math.min((reconnect.baseDelayMs ?? 1000) * Math.pow(2, this.reconnectAttempts - 1), reconnect.maxDelayMs ?? 8000) *
      (1 + (reconnect.jitter ?? 0));
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.loadCurrent();
      } catch (e) {
        this.bus.emit('error', e);
      }
    }, delay);
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
