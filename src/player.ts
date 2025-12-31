import { EventBus } from './core/eventBus.js';
import { MiddlewareManager } from './core/middleware.js';
import { TechManager } from './core/techManager.js';
import { PluginManager } from './core/pluginManager.js';
import { WebRTCTech } from './techs/tech-webrtc.js';
import { HLSDASHTech } from './techs/tech-hlsdash.js';
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
  PlayerOptions,
  PlayerState,
  Source,
  TechName,
  MetadataDetectedEvent
} from './types.js';
import { DEFAULT_BUFFER_POLICY, DEFAULT_METRICS_OPTIONS, DEFAULT_RECONNECT_POLICY, DEFAULT_TECH_ORDER } from './core/defaults.js';
import { resolveVideoElement } from './utils/video.js';
import { probeWebCodecs, WebCodecsSupport } from './utils/webcodecs.js';

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
  private statsTimer: any = null;
  private reconnectAttempts = 0;
  private reconnectTimer: any = null;
  private dataChannelOpts: DataChannelOptions | undefined;
  private failedTechs = new Set<TechName>();
  private techEventHandlers: Map<string, (...args: any[]) => void> = new Map();

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
    this.techManager.register('hlsdash', new HLSDASHTech());
    this.techManager.register('ws-raw', new WSRawTech());
    this.techManager.register('gb28181', new Gb28181Tech());
    this.techManager.register('file', new FileTech());

    // plugins
    const pluginCtx: PluginContext = {
      player: this,
      coreBus: this.bus,
      techs: this.techManager,
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

  getCurrentSource(): Source | undefined {
    return this.options.sources[this.currentSourceIndex];
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this.bus.on(event, handler);
  }

  once(event: string, handler: (...args: any[]) => void): void {
    this.bus.once(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
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
    this.failedTechs.clear();
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
      this.state = 'playing';
      this.bus.emit('play');
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
  async control(action: string, payload?: any): Promise<any> {
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
      const effectiveOrder = this.techOrder.filter((t) => !this.failedTechs.has(t));
      const techOrderToUse = effectiveOrder.length ? effectiveOrder : this.techOrder;
      
      // Requirements 6.1, 6.2: Handle Auto Source resolution
      if (source.type === 'auto') {
        const resolveCtx: MiddlewareContext = {
          source,
          tech: source.preferTech ?? techOrderToUse[0],
          url: source.url
        };
        
        // Run resolve middleware to get resolved sources
        const resolvedCtx = await this.middleware.run('resolve', resolveCtx);
        
        // Requirements 6.4: Emit error if no adapter resolved the source
        if (!resolvedCtx.resolvedSources) {
          const engine = (source as any).engine ?? 'unknown';
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
        tech: source.preferTech ?? techOrderToUse[0],
        url: (source as any).url
      };
      // run request middleware once before load
      await this.middleware.run('request', middlewareCtx);
      // apply middleware modifications
      const patchedSource = { ...middlewareCtx.source, url: middlewareCtx.url ?? (source as any).url };
      // run signal middleware (best-effort) before load
      await this.middleware.run('signal', { ...middlewareCtx, source: patchedSource, tech: patchedSource.preferTech ?? this.techOrder[0] });
      try {
        const loaded = await this.techManager.selectAndLoad([patchedSource], techOrderToUse, {
          buffer: this.bufferPolicy,
          reconnect: this.options.reconnect ?? DEFAULT_RECONNECT_POLICY,
          metrics: this.options.metrics ?? DEFAULT_METRICS_OPTIONS,
          video: this.videoEl,
          webCodecs: this.options.webCodecs,
          dataChannel: this.dataChannelOpts
        });
        if (!loaded) {
          throw new Error('No compatible tech/source');
        }
        this.attachTechEvents(loaded.tech);
        this.failedTechs.delete(loaded.tech);
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
    
    const forward = (event: EngineEvent, transform?: (args: any[]) => any[]) => {
      const handler = (...args: any[]) => {
        const payload = transform ? transform(args) : args;
        this.bus.emit(event, ...(payload ?? []));
        if (event === 'ready') {
          this.state = 'ready';
          this.reconnectAttempts = 0;
          this.failedTechs.clear();
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
    forward('qos');
    forward('sei');
    forward('data');
    forward('network', (args) => {
      const evt = args?.[0];
      // Enhance network event with human-readable message
      const enhancedEvt = this.enhanceNetworkEvent(evt);
      
      // 仅在明确 fatal/断线事件时触发重连，避免正常抖动导致重置
      // Only treat explicitly fatal or hard failures as fatal. Transient 'disconnected' should not trigger fallback.
      const fatal =
        evt?.fatal ||
        evt?.type === 'ice-failed' ||
        evt?.type === 'connect-timeout' ||
        evt?.type === 'ws-fallback-error' ||
        evt?.type === 'fatal';
      if (fatal) {
        const currentTech = this.techManager.getCurrentTechName();
        if (currentTech) this.failedTechs.add(currentTech);
        this.handleReconnect();
      }
      return [enhancedEvt];
    });
  }

  /**
   * Enhance network event with human-readable message and severity
   */
  private enhanceNetworkEvent(evt: any): any {
    if (!evt) return evt;
    
    const enhanced = { ...evt };
    
    // Add severity level
    const fatalTypes = ['ice-failed', 'connect-timeout', 'ws-fallback-error', 'fatal', 'signal-error', 'offer-timeout'];
    const warningTypes = ['metadata-timeout', 'autoplay-blocked', 'audio-disabled', 'audio-fallback', 'catchup', 'jitter'];
    
    if (evt.fatal || fatalTypes.includes(evt.type)) {
      enhanced.severity = 'fatal';
    } else if (warningTypes.includes(evt.type)) {
      enhanced.severity = 'warning';
    } else {
      enhanced.severity = 'info';
    }
    
    // Add human-readable message
    switch (evt.type) {
      case 'disconnect':
        enhanced.message = `连接断开 (状态: ${evt.state || 'unknown'})`;
        break;
      case 'ice-failed':
        enhanced.message = 'ICE 连接失败，正在尝试重连...';
        break;
      case 'connect-timeout':
        enhanced.message = `连接超时 (${evt.timeoutMs || 15000}ms)`;
        break;
      case 'signal-error':
        enhanced.message = '信令连接失败';
        break;
      case 'offer-timeout':
        enhanced.message = 'SDP Offer 超时';
        break;
      case 'ws-fallback-error':
        enhanced.message = 'WebSocket 回退失败';
        break;
      case 'fallback':
        enhanced.message = `已从 ${evt.from || 'primary'} 切换到 ${evt.to || 'fallback'} 源`;
        break;
      case 'reconnect':
        enhanced.message = `正在重连 (第 ${evt.attempt}/${evt.maxRetries} 次)`;
        break;
      case 'audio-disabled':
        enhanced.message = `音频已禁用: ${evt.reason || 'unknown'}`;
        break;
      case 'audio-fallback':
        enhanced.message = `音频解码失败: ${evt.reason || 'unknown'}`;
        break;
      case 'video-decode-error':
        enhanced.message = `视频解码错误 (累计 ${evt.errors} 次)`;
        break;
      case 'autoplay-blocked':
        enhanced.message = '自动播放被浏览器阻止，请点击播放';
        break;
      case 'metadata-timeout':
        enhanced.message = '视频元数据加载超时';
        break;
      case 'catchup':
        enhanced.message = `追帧: 丢弃 ${evt.dropped} 帧，保留 ${evt.kept} 帧 (模式: ${evt.mode})`;
        break;
      case 'ice-state':
        enhanced.message = `ICE 状态: ${evt.state}`;
        break;
      case 'ws-open':
        enhanced.message = 'WebSocket 连接已建立';
        break;
      case 'ws-close':
        enhanced.message = 'WebSocket 连接已关闭';
        break;
      default:
        enhanced.message = evt.message || `网络事件: ${evt.type}`;
    }
    
    return enhanced;
  }

  private detachTechEvents(): void {
    // Note: AbstractTech uses EventBus which doesn't expose off() on Tech interface
    // Clear our handler references to allow GC
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
    if (this.reconnectAttempts >= (reconnect.maxRetries ?? 3)) return;
    this.reconnectAttempts += 1;
    
    // Requirements 7.5: Emit reconnect event with attempt count
    this.bus.emit('network', { 
      type: 'reconnect', 
      attempt: this.reconnectAttempts,
      maxRetries: reconnect.maxRetries ?? 3
    });
    
    const delay =
      Math.min((reconnect.baseDelayMs ?? 1000) * Math.pow(2, this.reconnectAttempts - 1), reconnect.maxDelayMs ?? 8000) *
      (1 + (reconnect.jitter ?? 0));
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.loadCurrent();
        this.reconnectAttempts = 0;
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
