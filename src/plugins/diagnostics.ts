import type {
  EngineStats,
  PlayerNetworkEvent,
  PlayerQosEvent,
  PlayerState,
  PluginCtor,
  QualityState,
  Source,
  TechName,
} from '../types.js';

export type DiagnosticsEventType = 'network' | 'qos' | 'stats' | 'error' | 'ready' | 'play' | 'pause' | 'ended' | 'buffer';

export interface DiagnosticsEventRecord {
  type: DiagnosticsEventType;
  ts: number;
  payload?: unknown;
}

export interface DiagnosticsSnapshot {
  ts: number;
  state?: PlayerState;
  tech?: TechName | null;
  source?: Source;
  sourceIndex: number;
  quality?: QualityState;
  latestStats?: EngineStats;
  latestNetwork?: PlayerNetworkEvent;
  latestQos?: PlayerQosEvent;
  latestError?: unknown;
  reconnect?: {
    attempts: number;
    exhausted: boolean;
    lastAttempt?: number;
    maxRetries?: number;
  };
  webrtc?: {
    iceState?: string;
    signalStage?: string;
    audioMuted?: boolean;
  };
  buffer?: {
    level?: number;
    pendingSegments?: number;
    pendingBytes?: number;
  };
  recent: DiagnosticsEventRecord[];
}

export interface DiagnosticsHandle {
  snapshot(): DiagnosticsSnapshot;
  exportJson(space?: number): string;
  clear(): void;
  destroy(): void;
}

export interface DiagnosticsPluginOptions {
  /** Maximum recent event records kept in memory. Defaults to 200. */
  maxEvents?: number;
  /** Optional DOM host for a lightweight debug panel. Omit to collect snapshots only. */
  panel?: boolean | HTMLElement | string;
  /** Called whenever the diagnostics snapshot changes. */
  onSnapshot?: (snapshot: DiagnosticsSnapshot) => void;
  /** Called after a tracked event is recorded. */
  onEvent?: (record: DiagnosticsEventRecord, snapshot: DiagnosticsSnapshot) => void;
  /** Receives the created handle for imperative support-panel integrations. */
  onHandle?: (handle: DiagnosticsHandle) => void;
}

export type DebugPanelPluginOptions = Omit<DiagnosticsPluginOptions, 'panel'> & {
  /** Panel host. Defaults to document.body. */
  target?: HTMLElement | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asStatsPayload(payload: unknown): { tech?: TechName | null; stats?: EngineStats } | null {
  if (!isRecord(payload)) return null;
  const stats = payload.stats;
  if (!isRecord(stats)) return null;
  const normalizedStats = {
    ...stats,
    ts: typeof stats.ts === 'number' && Number.isFinite(stats.ts) ? stats.ts : Date.now(),
  } as EngineStats;
  return {
    tech: typeof payload.tech === 'string' ? (payload.tech as TechName) : null,
    stats: normalizedStats,
  };
}

function asNetworkPayload(payload: unknown): PlayerNetworkEvent | undefined {
  return isRecord(payload) ? (payload as PlayerNetworkEvent) : undefined;
}

function asQosPayload(payload: unknown): PlayerQosEvent | undefined {
  return isRecord(payload) ? (payload as PlayerQosEvent) : undefined;
}

function getSourceIndex(sources: Source[], source: Source | undefined): number {
  return source ? sources.indexOf(source) : -1;
}

export function createDiagnosticsPlugin(options: DiagnosticsPluginOptions = {}): PluginCtor {
  return ({ coreBus, player, techs }) => {
    const maxEvents = Math.max(1, options.maxEvents ?? 200);
    const recent: DiagnosticsEventRecord[] = [];
    let latestStats: EngineStats | undefined;
    let latestNetwork: PlayerNetworkEvent | undefined;
    let latestQos: PlayerQosEvent | undefined;
    let latestError: unknown;
    let reconnectAttempts = 0;
    let reconnectExhausted = false;
    let lastReconnectAttempt: number | undefined;
    let reconnectMaxRetries: number | undefined;
    let iceState: string | undefined;
    let signalStage: string | undefined;
    let webRtcAudioMuted = false;
    let bufferLevel: number | undefined;
    let pendingSegments: number | undefined;
    let pendingBytes: number | undefined;
    let destroyed = false;
    let panelRoot: HTMLElement | null = null;
    let panelBody: HTMLElement | null = null;

    const snapshot = (): DiagnosticsSnapshot => {
      let state: PlayerState | undefined;
      let source: Source | undefined;
      let sources: Source[] = [];
      let quality: QualityState | undefined;
      try {
        state = player.getState();
      } catch {
        state = undefined;
      }
      try {
        source = player.getCurrentSource();
        sources = player.getSources();
      } catch {
        source = undefined;
        sources = [];
      }
      try {
        quality = player.getQualityState();
      } catch {
        quality = undefined;
      }

      return {
        ts: Date.now(),
        state,
        tech: techs.getCurrentTechName(),
        source,
        sourceIndex: getSourceIndex(sources, source),
        quality,
        latestStats,
        latestNetwork,
        latestQos,
        latestError,
        reconnect: {
          attempts: reconnectAttempts,
          exhausted: reconnectExhausted,
          lastAttempt: lastReconnectAttempt,
          maxRetries: reconnectMaxRetries,
        },
        webrtc: {
          iceState,
          signalStage,
          audioMuted: webRtcAudioMuted,
        },
        buffer: {
          level: bufferLevel,
          pendingSegments,
          pendingBytes,
        },
        recent: [...recent],
      };
    };

    const handle: DiagnosticsHandle = {
      snapshot,
      exportJson: (space = 2) => JSON.stringify(snapshot(), null, space),
      clear: () => {
        recent.length = 0;
        latestStats = undefined;
        latestNetwork = undefined;
        latestQos = undefined;
        latestError = undefined;
        reconnectAttempts = 0;
        reconnectExhausted = false;
        lastReconnectAttempt = undefined;
        reconnectMaxRetries = undefined;
        iceState = undefined;
        signalStage = undefined;
        webRtcAudioMuted = false;
        bufferLevel = undefined;
        pendingSegments = undefined;
        pendingBytes = undefined;
      },
      destroy: () => cleanup(),
    };

    const record = (type: DiagnosticsEventType, payload?: unknown): void => {
      if (destroyed) return;
      const entry: DiagnosticsEventRecord = { type, ts: Date.now(), payload };
      recent.push(entry);
      while (recent.length > maxEvents) recent.shift();
      const currentSnapshot = snapshot();
      renderPanel(currentSnapshot);
      options.onEvent?.(entry, currentSnapshot);
      options.onSnapshot?.(currentSnapshot);
    };

    const resolvePanelHost = (): HTMLElement | null => {
      if (!options.panel) return null;
      if (options.panel === true) return document.body;
      if (typeof options.panel === 'string') {
        return document.querySelector(options.panel) as HTMLElement | null;
      }
      return options.panel;
    };

    const setupPanel = (): void => {
      if (typeof document === 'undefined') return;
      const host = resolvePanelHost();
      if (!host) return;
      panelRoot = document.createElement('div');
      panelRoot.className = 'fyra-diagnostics-panel';
      panelRoot.setAttribute(
        'style',
        [
          'position:absolute',
          'right:12px',
          'top:12px',
          'z-index:2147483647',
          'width:min(360px, calc(100% - 24px))',
          'max-height:min(70vh, 520px)',
          'overflow:auto',
          'box-sizing:border-box',
          'padding:10px',
          'border-radius:6px',
          'background:rgba(17,24,39,0.92)',
          'color:#f9fafb',
          'font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          'box-shadow:0 8px 32px rgba(0,0,0,0.35)',
          'pointer-events:auto'
        ].join(';')
      );
      const title = document.createElement('div');
      title.textContent = 'FyraPlayer Debug';
      title.setAttribute('style', 'font-weight:600;margin-bottom:8px');
      panelBody = document.createElement('div');
      const actions = document.createElement('div');
      actions.setAttribute('style', 'display:flex;gap:6px;margin-top:8px');
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.textContent = 'Export JSON';
      exportButton.setAttribute('style', 'font:inherit;padding:4px 6px;border:0;border-radius:4px;cursor:pointer');
      exportButton.addEventListener('click', () => {
        const json = handle.exportJson();
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(json).catch(() => undefined);
        }
        options.onEvent?.({ type: 'stats', ts: Date.now(), payload: { action: 'diagnostics-export' } }, snapshot());
      });
      const clearButton = document.createElement('button');
      clearButton.type = 'button';
      clearButton.textContent = 'Clear';
      clearButton.setAttribute('style', 'font:inherit;padding:4px 6px;border:0;border-radius:4px;cursor:pointer');
      clearButton.addEventListener('click', () => {
        handle.clear();
        renderPanel(snapshot());
      });
      actions.append(exportButton, clearButton);
      panelRoot.append(title, panelBody, actions);
      host.appendChild(panelRoot);
      renderPanel(snapshot());
    };

    const line = (label: string, value: unknown): string => `${label}: ${value ?? '-'}`;

    const renderPanel = (value: DiagnosticsSnapshot): void => {
      if (!panelBody) return;
      const latestCode = value.latestNetwork?.code || value.latestNetwork?.type || '-';
      const latestQos = value.latestQos?.code || value.latestQos?.type || '-';
      panelBody.textContent = [
        line('state', value.state),
        line('tech', value.tech),
        line('source', value.source?.type),
        line('url', value.source?.url),
        line('quality', value.quality?.supported ? `${value.quality.auto ? 'auto' : 'manual'}:${value.quality.current ?? '-'}` : 'unsupported'),
        line('fps', value.latestStats?.fps),
        line('bitrate', value.latestStats?.bitrateKbps),
        line('buffer', value.buffer?.level),
        line('pending', value.buffer?.pendingBytes),
        line('network', latestCode),
        line('qos', latestQos),
        line('reconnect', `${value.reconnect?.attempts ?? 0}/${value.reconnect?.maxRetries ?? '-'}`),
        line('ice', value.webrtc?.iceState),
        line('events', value.recent.length)
      ].join('\n');
    };

    const readyHandler = () => {
      reconnectAttempts = 0;
      reconnectExhausted = false;
      record('ready');
    };
    const playHandler = () => record('play');
    const pauseHandler = () => record('pause');
    const endedHandler = () => record('ended');
    const bufferHandler = (payload?: unknown) => {
      if (isRecord(payload) && typeof payload.level === 'number') {
        bufferLevel = payload.level;
      }
      record('buffer', payload);
    };
    const errorHandler = (payload?: unknown) => {
      latestError = payload;
      record('error', payload);
    };
    const statsHandler = (payload?: unknown) => {
      const statsPayload = asStatsPayload(payload);
      if (statsPayload?.stats) {
        latestStats = statsPayload.stats;
        bufferLevel = statsPayload.stats.bufferLevel ?? bufferLevel;
        pendingSegments = statsPayload.stats.pendingSegments ?? pendingSegments;
        pendingBytes = statsPayload.stats.pendingBytes ?? pendingBytes;
      }
      record('stats', payload);
    };
    const qosHandler = (payload?: unknown) => {
      latestQos = asQosPayload(payload);
      record('qos', payload);
    };
    const networkHandler = (payload?: unknown) => {
      const evt = asNetworkPayload(payload);
      latestNetwork = evt;
      if (evt) {
        if (evt.type === 'reconnect' || evt.code === 'RECONNECT_ATTEMPT') {
          reconnectAttempts = typeof evt.attempt === 'number' ? evt.attempt : reconnectAttempts + 1;
          lastReconnectAttempt = reconnectAttempts;
          reconnectMaxRetries = typeof evt.maxRetries === 'number' ? evt.maxRetries : reconnectMaxRetries;
          reconnectExhausted = false;
        }
        if (evt.type === 'reconnect-exhausted' || evt.code === 'RECONNECT_EXHAUSTED') {
          reconnectAttempts = typeof evt.attempt === 'number' ? evt.attempt : reconnectAttempts;
          reconnectMaxRetries = typeof evt.maxRetries === 'number' ? evt.maxRetries : reconnectMaxRetries;
          reconnectExhausted = true;
        }
        if (typeof evt.state === 'string' && (evt.type === 'ice-state' || evt.code === 'WEBRTC_ICE_STATE')) {
          iceState = evt.state;
        }
        if (typeof evt.stage === 'string') {
          signalStage = evt.stage;
        }
        if (evt.type === 'webrtc-audio-muted' || evt.code === 'WEBRTC_AUDIO_MUTED') {
          webRtcAudioMuted = true;
        }
        pendingSegments = typeof evt.pendingSegments === 'number' ? evt.pendingSegments : pendingSegments;
        pendingBytes = typeof evt.pendingBytes === 'number' ? evt.pendingBytes : pendingBytes;
      }
      record('network', payload);
    };

    const cleanup = (): void => {
      if (destroyed) return;
      destroyed = true;
      coreBus.off('ready', readyHandler);
      coreBus.off('play', playHandler);
      coreBus.off('pause', pauseHandler);
      coreBus.off('ended', endedHandler);
      coreBus.off('buffer', bufferHandler);
      coreBus.off('error', errorHandler);
      coreBus.off('stats', statsHandler);
      coreBus.off('qos', qosHandler);
      coreBus.off('network', networkHandler);
      panelRoot?.remove();
      panelRoot = null;
      panelBody = null;
      recent.length = 0;
    };

    coreBus.on('ready', readyHandler);
    coreBus.on('play', playHandler);
    coreBus.on('pause', pauseHandler);
    coreBus.on('ended', endedHandler);
    coreBus.on('buffer', bufferHandler);
    coreBus.on('error', errorHandler);
    coreBus.on('stats', statsHandler);
    coreBus.on('qos', qosHandler);
    coreBus.on('network', networkHandler);

    setupPanel();
    options.onHandle?.(handle);

    return {
      destroy: cleanup,
    };
  };
}

export function createDebugPanelPlugin(options: DebugPanelPluginOptions = {}): PluginCtor {
  return createDiagnosticsPlugin({
    ...options,
    panel: options.target ?? true,
  });
}
