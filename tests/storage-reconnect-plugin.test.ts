import { createReconnectPlugin } from '../src/plugins/reconnect.js';
import { createStoragePlugin } from '../src/plugins/storage.js';
import type { EventBusLike, KeyValueStore, PlayerAPI, PluginContext, Source } from '../src/types.js';

type Handler = (...args: unknown[]) => void;

class BusStub implements EventBusLike {
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, listener: Handler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(listener);
  }

  once(event: string, listener: Handler): void {
    const onceHandler = (...args: unknown[]) => {
      this.off(event, onceHandler);
      listener(...args);
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

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((handler) => handler(...args));
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

class MemoryStorage implements KeyValueStore {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

interface VideoStub {
  volume: number;
  muted: boolean;
  playbackRate: number;
}

class PlayerStub implements PlayerAPI {
  currentTime = 0;
  readonly switchSource = jest.fn(async (_index: number) => undefined);
  readonly setQualityLevel = jest.fn(async (_level?: number | string | 'auto') => undefined);
  private currentIndex = 0;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(private readonly sources: Source[]) {}

  async play(): Promise<void> {}
  async pause(): Promise<void> {}
  async seek(): Promise<void> {}
  getQualityState() { return { supported: false, auto: true, current: null, levels: [] }; }
  getState() { return 'idle' as const; }
  getSources(): Source[] { return this.sources; }
  getCurrentSource(): Source | undefined { return this.sources[this.currentIndex]; }
  async control(): Promise<unknown> { return undefined; }
  enableMetadataExtraction(): void {}
  disableMetadataExtraction(): void {}
  getDetectedPrivateDataPids(): number[] { return []; }
  getDetectedSeiTypes(): number[] { return []; }

  on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  once(event: string, handler: Handler): void {
    const onceHandler = (...args: unknown[]) => {
      this.off(event, onceHandler);
      handler(...args);
    };
    this.on(event, onceHandler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string): void {
    this.handlers.get(event)?.forEach((handler) => handler());
  }

  emitPayload(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  setCurrentIndex(index: number): void {
    this.currentIndex = index;
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

function createContext(player: PlayerAPI, bus: BusStub, storage: KeyValueStore | null): PluginContext {
  return {
    player,
    coreBus: bus,
    techs: {} as PluginContext['techs'],
    storage,
  };
}

describe('storage plugin lifecycle', () => {
  const sources: Source[] = [
    { type: 'hls', url: 'https://example.com/one.m3u8' },
    { type: 'dash', url: 'https://example.com/two.mpd' },
  ];

  test('restores valid source index, persists on play, and detaches on destroy', () => {
    const bus = new BusStub();
    const storage = new MemoryStorage();
    storage.setItem('source-key', '1');
    const player = new PlayerStub(sources);
    const plugin = createStoragePlugin({ key: 'source-key' });

    const lifecycle = plugin(createContext(player, bus, storage));

    expect(player.switchSource).toHaveBeenCalledWith(1);
    expect(player.listenerCount('play')).toBe(1);

    player.setCurrentIndex(0);
    player.emit('play');
    expect(storage.getItem('source-key')).toBe('0');

    lifecycle?.destroy?.();
    expect(player.listenerCount('play')).toBe(0);

    player.setCurrentIndex(1);
    player.emit('play');
    expect(storage.getItem('source-key')).toBe('0');
  });

  test('ignores invalid restored source indexes', () => {
    const bus = new BusStub();
    const storage = new MemoryStorage();
    storage.setItem('source-key', '99');
    const player = new PlayerStub(sources);

    createStoragePlugin({ key: 'source-key' })(createContext(player, bus, storage));

    expect(player.switchSource).not.toHaveBeenCalled();
  });

  test('restores and persists playback preferences when enabled', async () => {
    const bus = new BusStub();
    const storage = new MemoryStorage();
    storage.setItem('prefs-key', JSON.stringify({
      volume: 0.4,
      muted: true,
      playbackRate: 1.5,
      quality: 'auto',
      lowLatency: true,
      sourceIndex: 1,
    }));
    const video: VideoStub = { volume: 1, muted: false, playbackRate: 1 };
    const player = new PlayerStub([
      { type: 'hls', url: 'https://example.com/one.m3u8', lowLatency: false },
      { type: 'hls', url: 'https://example.com/two.m3u8', lowLatency: false },
    ]);

    const lifecycle = createStoragePlugin({
      key: 'source-key',
      preferencesKey: 'prefs-key',
      video: video as HTMLVideoElement,
      persistVolume: true,
      persistMuted: true,
      persistPlaybackRate: true,
      persistQuality: true,
      persistLowLatency: true,
    })(createContext(player, bus, storage));

    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(1.5);
    expect(player.getSources()).toEqual([
      expect.objectContaining({ lowLatency: true }),
      expect.objectContaining({ lowLatency: true }),
    ]);
    expect(player.switchSource).toHaveBeenCalledWith(1);

    player.emit('ready');
    await Promise.resolve();
    expect(player.setQualityLevel).toHaveBeenCalledWith('auto');

    player.emitPayload('preference', { key: 'volume', value: 0.75, source: 'ui' });
    player.emitPayload('preference', { key: 'muted', value: false, source: 'ui' });
    player.emitPayload('preference', { key: 'playbackRate', value: 2, source: 'ui' });
    player.emitPayload('preference', { key: 'quality', value: 0, source: 'ui' });
    player.emitPayload('preference', { key: 'lowLatency', value: false, source: 'ui' });
    player.emitPayload('preference', { key: 'sourceIndex', value: 0, source: 'ui' });

    expect(JSON.parse(storage.getItem('prefs-key') || '{}')).toEqual({
      volume: 0.75,
      muted: false,
      playbackRate: 2,
      quality: 0,
      lowLatency: false,
      sourceIndex: 0,
    });
    expect(storage.getItem('source-key')).toBe('0');
    expect(player.getSources()).toEqual([
      expect.objectContaining({ lowLatency: false }),
      expect.objectContaining({ lowLatency: false }),
    ]);

    lifecycle?.destroy?.();
    player.emitPayload('preference', { key: 'volume', value: 0.1, source: 'ui' });
    expect(JSON.parse(storage.getItem('prefs-key') || '{}').volume).toBe(0.75);
  });
});

describe('reconnect plugin lifecycle', () => {
  test('reports network/error callbacks and detaches on destroy', () => {
    const bus = new BusStub();
    const player = new PlayerStub([]);
    const onNetwork = jest.fn();
    const onError = jest.fn();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const lifecycle = createReconnectPlugin({
      onNetwork,
      onError,
      logNetwork: false,
      logError: false,
    })(createContext(player, bus, null));

    expect(bus.listenerCount('network')).toBe(1);
    expect(bus.listenerCount('error')).toBe(1);

    bus.emit('network', { code: 'HLS_WARNING' });
    bus.emit('error', new Error('boom'));

    expect(onNetwork).toHaveBeenCalledWith({ code: 'HLS_WARNING' });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    lifecycle?.destroy?.();
    expect(bus.listenerCount('network')).toBe(0);
    expect(bus.listenerCount('error')).toBe(0);

    bus.emit('network', { code: 'AFTER_DESTROY' });
    bus.emit('error', new Error('after destroy'));

    expect(onNetwork).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    warn.mockRestore();
    error.mockRestore();
  });
});
