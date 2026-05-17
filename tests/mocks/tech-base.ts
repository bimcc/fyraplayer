import type { Source } from '../../src/types.js';

type Handler = (...args: any[]) => void;

export class MockTechBase {
  public lastLoadedSource: Source | null = null;
  public emitReadyDuringLoad = false;
  public playCalls = 0;
  public pauseCalls = 0;
  public seekCalls = 0;
  public destroyCalls = 0;
  public lastSeekTime: number | null = null;
  private handlers = new Map<string, Set<Handler>>();

  constructor(private readonly playableType: Source['type']) {}

  canPlay(source: Source): boolean {
    return source.type === this.playableType;
  }

  async load(source: Source): Promise<void> {
    this.lastLoadedSource = source;
    if (this.emitReadyDuringLoad) {
      this.emit('ready');
    }
  }

  async play(): Promise<void> {
    this.playCalls += 1;
  }

  async pause(): Promise<void> {
    this.pauseCalls += 1;
  }

  async seek(time: number): Promise<void> {
    this.seekCalls += 1;
    this.lastSeekTime = time;
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }

  getStats() {
    return { ts: Date.now() };
  }

  on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: any[]): void {
    this.handlers.get(event)?.forEach((handler) => handler(...args));
  }
}

type TechKey = 'webrtc' | 'hls' | 'dash' | 'fmp4' | 'ws-raw' | 'gb28181' | 'file';

export const mockTechInstances: Record<TechKey, MockTechBase[]> = {
  webrtc: [],
  hls: [],
  dash: [],
  fmp4: [],
  'ws-raw': [],
  gb28181: [],
  file: []
};

export function resetMockTechInstances(): void {
  (Object.keys(mockTechInstances) as TechKey[]).forEach((key) => {
    mockTechInstances[key].length = 0;
  });
}

export function registerInstance(kind: TechKey, instance: MockTechBase): void {
  mockTechInstances[kind].push(instance);
}
