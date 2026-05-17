import { createMetadataPlugin } from '../src/plugins/metadata/index.js';
import type { MetadataEvent, PluginContext } from '../src/types.js';

type Handler = (event: unknown) => void;

class PlayerStub {
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

function createContext(player: PlayerStub): PluginContext {
  return {
    player: player as unknown as PluginContext['player'],
    coreBus: {} as PluginContext['coreBus'],
    techs: {} as PluginContext['techs'],
    storage: null
  };
}

describe('createMetadataPlugin', () => {
  test('parses raw metadata events and detaches on destroy', async () => {
    const player = new PlayerStub();
    const parse = jest.fn((event: MetadataEvent) => ({ pts: event.pts, bytes: event.raw.byteLength }));
    const onData = jest.fn();
    const onError = jest.fn();

    const plugin = createMetadataPlugin({ parse, onData, onError });
    const lifecycle = plugin(createContext(player));

    const rawEvent: MetadataEvent = {
      type: 'private-data',
      raw: new Uint8Array([1, 2, 3]),
      pts: 123,
      pid: 256
    };

    player.emit('metadata', rawEvent);
    await Promise.resolve();

    expect(parse).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith({ pts: 123, bytes: 3 }, rawEvent);
    expect(onError).not.toHaveBeenCalled();

    lifecycle?.destroy?.();
    player.emit('metadata', { ...rawEvent, pts: 456 });
    await Promise.resolve();

    expect(parse).toHaveBeenCalledTimes(1);
  });

  test('does not send detect-only events to raw parsers by default', async () => {
    const player = new PlayerStub();
    const parse = jest.fn();
    const onData = jest.fn();
    const onError = jest.fn();

    const plugin = createMetadataPlugin({ parse, onData, onError });
    plugin(createContext(player));

    player.emit('metadata', { type: 'private-data-detected', pids: [256] });
    await Promise.resolve();

    expect(parse).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('can route detect-only events to onDetected', async () => {
    const player = new PlayerStub();
    const parse = jest.fn();
    const onData = jest.fn();
    const onDetected = jest.fn();

    const plugin = createMetadataPlugin({ parse, onData, onDetected });
    plugin(createContext(player));

    const detected = { type: 'private-data-detected', pids: [256] };
    player.emit('metadata', detected);
    await Promise.resolve();

    expect(parse).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(onDetected).toHaveBeenCalledWith(detected);
  });

  test('reports parser errors through onError', async () => {
    const player = new PlayerStub();
    const thrown = new Error('parse failed');
    const parse = jest.fn(() => {
      throw thrown;
    });
    const onData = jest.fn();
    const onError = jest.fn();
    const rawEvent: MetadataEvent = { type: 'sei', raw: new Uint8Array([5]), pts: 1, seiType: 5 };

    const plugin = createMetadataPlugin({ parse, onData, onError });
    plugin(createContext(player));

    player.emit('metadata', rawEvent);
    await Promise.resolve();

    expect(onData).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(thrown, rawEvent);
  });
});
