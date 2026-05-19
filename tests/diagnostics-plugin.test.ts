import {
  createDiagnosticsPlugin,
  type DiagnosticsHandle,
  type DiagnosticsSnapshot,
} from '../src/plugins/diagnostics.js';
import type { EventBusLike, PluginContext, Source, TechName } from '../src/types.js';

type Handler = (payload?: unknown) => void;

class BusStub implements EventBusLike {
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, listener: Handler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(listener);
  }

  once(event: string, listener: Handler): void {
    const onceHandler = (payload?: unknown) => {
      this.off(event, onceHandler);
      listener(payload);
    };
    this.on(event, onceHandler);
  }

  off(event: string, listener: Handler): void {
    this.handlers.get(event)?.delete(listener);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
      return;
    }
    this.handlers.clear();
  }

  emit(event: string, payload?: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

class ClassListStub {
  private values = new Set<string>();

  add(value: string): void {
    this.values.add(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class ElementStub {
  readonly children: ElementStub[] = [];
  readonly classList = new ClassListStub();
  readonly listeners = new Map<string, Set<() => void>>();
  private ownTextContent = '';
  private ownClassName = '';
  type = '';
  parentElement: ElementStub | null = null;

  constructor(public readonly tagName: string) {}

  get textContent(): string {
    return [this.ownTextContent, ...this.children.map((child) => child.textContent)].join('');
  }

  set textContent(value: string) {
    this.ownTextContent = value;
  }

  get className(): string {
    return this.ownClassName;
  }

  set className(value: string) {
    this.ownClassName = value;
    value.split(/\s+/).filter(Boolean).forEach((className) => this.classList.add(className));
  }

  append(...children: ElementStub[]): void {
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child: ElementStub): ElementStub {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
    this.classList.remove('fyra-diagnostics-panel');
  }

  setAttribute(_name: string, _value: string): void {}

  addEventListener(event: string, listener: () => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
  }

  querySelector(selector: string): ElementStub | null {
    if (selector === '.fyra-diagnostics-panel') {
      if (this.classList.contains('fyra-diagnostics-panel')) return this;
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }
}

function createContext(bus: BusStub): PluginContext {
  const sources: Source[] = [
    { type: 'hls', url: 'https://example.com/live.m3u8', preferTech: 'hls' },
  ];
  return {
    player: {
      getState: () => 'playing',
      getSources: () => sources,
      getCurrentSource: () => sources[0],
      getQualityState: () => ({
        supported: true,
        tech: 'hls',
        auto: true,
        current: null,
        levels: [{ id: 0, height: 720 }],
      }),
    } as PluginContext['player'],
    coreBus: bus,
    techs: {
      getCurrentTech: () => null,
      getTech: () => null,
      getCurrentTechName: () => 'hls' as TechName,
      getRegisteredTechs: () => ['hls'] as TechName[],
      register: (() => {
        throw new Error('not implemented');
      }) as PluginContext['techs']['register'],
    },
    storage: null,
  };
}

describe('createDiagnosticsPlugin', () => {
  test('collects state, source, tech, stats, network, qos, and exports JSON', () => {
    const bus = new BusStub();
    let handle: DiagnosticsHandle | undefined;
    const onSnapshot = jest.fn();
    const onEvent = jest.fn();
    const lifecycle = createDiagnosticsPlugin({
      maxEvents: 3,
      onHandle: (created) => {
        handle = created;
      },
      onSnapshot,
      onEvent,
    })(createContext(bus));

    bus.emit('stats', {
      tech: 'hls',
      stats: {
        ts: 1_000,
        fps: 30,
        bufferLevel: 6,
        pendingSegments: 2,
        pendingBytes: 4096,
      },
    });
    bus.emit('network', { type: 'ice-state', code: 'WEBRTC_ICE_STATE', state: 'connected' });
    bus.emit('network', { type: 'reconnect', code: 'RECONNECT_ATTEMPT', attempt: 2, maxRetries: 5 });
    bus.emit('qos', { type: 'performance-budget', code: 'PERFORMANCE_BUDGET', severity: 'warning' });
    bus.emit('error', { message: 'boom' });

    const snapshot = handle?.snapshot() as DiagnosticsSnapshot;
    expect(snapshot).toEqual(
      expect.objectContaining({
        state: 'playing',
        tech: 'hls',
        sourceIndex: 0,
        latestStats: expect.objectContaining({ fps: 30, bufferLevel: 6 }),
        latestNetwork: expect.objectContaining({ type: 'reconnect', attempt: 2 }),
        latestQos: expect.objectContaining({ code: 'PERFORMANCE_BUDGET' }),
        latestError: { message: 'boom' },
        reconnect: expect.objectContaining({ attempts: 2, maxRetries: 5, exhausted: false }),
        webrtc: expect.objectContaining({ iceState: 'connected' }),
        buffer: expect.objectContaining({ level: 6, pendingSegments: 2, pendingBytes: 4096 }),
      })
    );
    expect(snapshot.quality?.levels[0].height).toBe(720);
    expect(snapshot.recent).toHaveLength(3);
    expect(snapshot.recent.map((entry) => entry.type)).toEqual(['network', 'qos', 'error']);
    expect(handle?.exportJson()).toContain('"state": "playing"');
    expect(onSnapshot).toHaveBeenCalled();
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
      expect.objectContaining({ latestError: { message: 'boom' } })
    );

    lifecycle?.destroy?.();
  });

  test('tracks reconnect exhaustion, clears state, and detaches on destroy', () => {
    const bus = new BusStub();
    let handle: DiagnosticsHandle | undefined;
    const onSnapshot = jest.fn();
    const lifecycle = createDiagnosticsPlugin({
      onHandle: (created) => {
        handle = created;
      },
      onSnapshot,
    })(createContext(bus));

    bus.emit('network', {
      type: 'reconnect-exhausted',
      code: 'RECONNECT_EXHAUSTED',
      attempt: 3,
      maxRetries: 3,
      fatal: true,
    });
    expect(handle?.snapshot().reconnect).toEqual(
      expect.objectContaining({ attempts: 3, exhausted: true, maxRetries: 3 })
    );

    handle?.clear();
    expect(handle?.snapshot()).toEqual(
      expect.objectContaining({
        latestNetwork: undefined,
        reconnect: expect.objectContaining({ attempts: 0, exhausted: false }),
        recent: [],
      })
    );

    lifecycle?.destroy?.();
    bus.emit('error', { message: 'after destroy' });
    expect(handle?.snapshot().recent).toHaveLength(0);
  });

  test('renders an optional debug panel and removes it on destroy', () => {
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      value: {
        body: new ElementStub('body'),
        createElement: (tagName: string) => new ElementStub(tagName),
        querySelector: () => null,
      },
      configurable: true,
    });
    const bus = new BusStub();
    const panelHost = new ElementStub('div');
    let handle: DiagnosticsHandle | undefined;
    try {
      const lifecycle = createDiagnosticsPlugin({
        panel: panelHost as unknown as HTMLElement,
        onHandle: (created) => {
          handle = created;
        },
      })(createContext(bus));

      expect(panelHost.querySelector('.fyra-diagnostics-panel')).not.toBeNull();

      bus.emit('stats', { tech: 'hls', stats: { ts: 1_000, fps: 25, bitrateKbps: 800 } });
      bus.emit('network', { type: 'reconnect', code: 'RECONNECT_ATTEMPT', attempt: 1, maxRetries: 3 });

      const panel = panelHost.querySelector('.fyra-diagnostics-panel') as ElementStub;
      expect(panel.textContent).toContain('FyraPlayer Debug');
      expect(panel.textContent).toContain('state: playing');
      expect(panel.textContent).toContain('network: RECONNECT_ATTEMPT');
      expect(handle?.exportJson()).toContain('RECONNECT_ATTEMPT');

      lifecycle?.destroy?.();
      expect(panelHost.querySelector('.fyra-diagnostics-panel')).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
    }
  });
});
