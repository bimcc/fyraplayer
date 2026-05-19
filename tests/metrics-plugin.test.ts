import { createMetricsPlugin } from '../src/plugins/metrics.js';
import type { EventBusLike, PluginContext } from '../src/types.js';

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

function createContext(bus: BusStub): PluginContext {
  return {
    player: {} as PluginContext['player'],
    coreBus: bus,
    techs: {} as PluginContext['techs'],
    storage: null
  };
}

describe('createMetricsPlugin', () => {
  test('reports stats and qos events and detaches on destroy', () => {
    const bus = new BusStub();
    const onStats = jest.fn();
    const onQos = jest.fn();
    const onEvent = jest.fn();
    const plugin = createMetricsPlugin({ onStats, onQos, onEvent });

    const lifecycle = plugin(createContext(bus));

    const statsPayload = { tech: 'hls', stats: { ts: 123, width: 1280, height: 720 } };
    const qosPayload = {
      type: 'webcodecs-config',
      code: 'WEBCODECS_CONFIG',
      severity: 'info',
      message: 'WebCodecs 配置已启用: avc1.640028',
      tech: 'hls',
      ts: 123,
      codec: 'avc1.640028'
    };
    bus.emit('stats', statsPayload);
    bus.emit('qos', qosPayload);

    expect(onStats).toHaveBeenCalledWith(statsPayload);
    expect(onQos).toHaveBeenCalledWith(qosPayload);
    expect(onEvent).toHaveBeenCalledWith('stats', statsPayload);
    expect(onEvent).toHaveBeenCalledWith('qos', qosPayload);

    lifecycle?.destroy?.();
    bus.emit('stats', { tech: 'dash', stats: { ts: 456 } });
    bus.emit('qos', { type: 'after-destroy' });

    expect(onStats).toHaveBeenCalledTimes(1);
    expect(onQos).toHaveBeenCalledTimes(1);
  });

  test('ignores malformed stats payloads', () => {
    const bus = new BusStub();
    const onStats = jest.fn();
    const onEvent = jest.fn();

    createMetricsPlugin({ onStats, onEvent })(createContext(bus));

    bus.emit('stats', undefined);
    bus.emit('stats', { tech: 'hls' });
    bus.emit('stats', 'not-an-object');

    expect(onStats).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });

  test('passes normalized qos payloads through unchanged', () => {
    const bus = new BusStub();
    const onQos = jest.fn();
    const onEvent = jest.fn();

    createMetricsPlugin({ onQos, onEvent })(createContext(bus));

    const qosPayload = {
      type: 'webcodecs-ts-warning',
      code: 'WEBCODECS_TS_WARNING',
      severity: 'warning',
      message: 'WebCodecs TS 解码警告: 2 errors, 12 frames',
      tech: 'file',
      ts: 456,
      decodedFrames: 12,
      decodeErrors: 2
    };
    bus.emit('qos', qosPayload);

    expect(onQos).toHaveBeenCalledWith(qosPayload);
    expect(onEvent).toHaveBeenCalledWith('qos', qosPayload);
  });
});
