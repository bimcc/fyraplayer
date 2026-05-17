import { createPerformanceMonitorPlugin, DEFAULT_PERFORMANCE_BUDGET } from '../src/plugins/performance.js';
import type { EventBusLike, PluginContext } from '../src/types.js';

type Handler = (payload?: unknown) => void;

class BusStub implements EventBusLike {
  readonly emitted: Array<{ event: string; payload?: unknown }> = [];
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
    this.emitted.push({ event, payload });
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

function createContext(bus: BusStub): PluginContext {
  return {
    player: { getState: () => 'playing' } as PluginContext['player'],
    coreBus: bus,
    techs: {} as PluginContext['techs'],
    storage: null,
  };
}

describe('createPerformanceMonitorPlugin', () => {
  test('normalizes samples from stats events', () => {
    const bus = new BusStub();
    const onSample = jest.fn();

    createPerformanceMonitorPlugin({ onSample, emitQos: false })(createContext(bus));

    bus.emit('stats', {
      tech: 'hls',
      stats: { ts: 1_000, fps: 30, bitrateKbps: 2500, width: 1280, height: 720 },
    });

    expect(onSample).toHaveBeenCalledTimes(1);
    expect(onSample.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        tech: 'hls',
        ts: 1_000,
        sequence: 1,
        reportedFps: 30,
        fps: 30,
        fpsSource: 'reported',
      })
    );
  });

  test('evaluates cumulative frame counters when configured', () => {
    const bus = new BusStub();
    const onSample = jest.fn();

    createPerformanceMonitorPlugin({
      fpsMode: 'cumulative',
      onSample,
      emitQos: false,
    })(createContext(bus));

    bus.emit('stats', { tech: 'hls', stats: { ts: 1_000, fps: 100, droppedFrames: 0 } });
    bus.emit('stats', { tech: 'hls', stats: { ts: 2_000, fps: 130, droppedFrames: 0 } });

    expect(onSample).toHaveBeenCalledTimes(2);
    expect(onSample.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        sampledFps: 30,
        fps: 30,
        fpsSource: 'frame-delta',
        frameDelta: 30,
      })
    );
  });

  test('reports budget violations and emits qos events', () => {
    const bus = new BusStub();
    const onViolation = jest.fn();
    const onEvent = jest.fn();

    createPerformanceMonitorPlugin({
      budget: {
        ...DEFAULT_PERFORMANCE_BUDGET,
        minFps: 25,
        maxDecodeLatencyMs: 40,
        maxPendingBytes: 1024,
      },
      violationCooldownMs: 0,
      onViolation,
      onEvent,
    })(createContext(bus));

    bus.emit('stats', {
      tech: 'fmp4',
      stats: {
        ts: 3_000,
        fps: 12,
        decodeLatencyMs: 64,
        pendingBytes: 2048,
      },
    });

    expect(onViolation.mock.calls.map(([violation]) => violation.code)).toEqual([
      'LOW_FPS',
      'HIGH_DECODE_LATENCY',
      'HIGH_PENDING_BYTES',
    ]);
    expect(onEvent).toHaveBeenCalledWith('violation', expect.objectContaining({ code: 'LOW_FPS' }));
    expect(bus.emitted).toEqual(
      expect.arrayContaining([
        {
          event: 'qos',
          payload: expect.objectContaining({
            type: 'performance-budget',
            code: 'PERFORMANCE_BUDGET',
            severity: 'warning',
            tech: 'fmp4',
            reason: 'LOW_FPS',
          }),
        },
      ])
    );
  });

  test('skips budget evaluation while player is not playing by default', () => {
    const bus = new BusStub();
    const onSample = jest.fn();
    const onViolation = jest.fn();

    createPerformanceMonitorPlugin({
      budget: { minFps: 25 },
      onSample,
      onViolation,
    })({
      ...createContext(bus),
      player: { getState: () => 'paused' } as PluginContext['player'],
    });

    bus.emit('stats', { tech: 'hls', stats: { ts: 1_000, fps: 0 } });

    expect(onSample).toHaveBeenCalledTimes(1);
    expect(onViolation).not.toHaveBeenCalled();
    expect(bus.emitted.filter((entry) => entry.event === 'qos')).toHaveLength(0);
  });

  test('suppresses repeated violations during cooldown', () => {
    const bus = new BusStub();
    const onViolation = jest.fn();

    createPerformanceMonitorPlugin({
      budget: { minFps: 25 },
      violationCooldownMs: 30_000,
      onViolation,
      emitQos: false,
    })(createContext(bus));

    bus.emit('stats', { tech: 'dash', stats: { ts: 10_000, fps: 10 } });
    bus.emit('stats', { tech: 'dash', stats: { ts: 11_000, fps: 12 } });
    bus.emit('stats', { tech: 'dash', stats: { ts: 41_000, fps: 11 } });

    expect(onViolation).toHaveBeenCalledTimes(2);
  });

  test('ignores malformed payloads and detaches on destroy', () => {
    const bus = new BusStub();
    const onSample = jest.fn();
    const onViolation = jest.fn();
    const lifecycle = createPerformanceMonitorPlugin({ onSample, onViolation })(createContext(bus));

    bus.emit('stats', undefined);
    bus.emit('stats', { tech: 'hls' });
    bus.emit('stats', 'bad-payload');

    expect(onSample).not.toHaveBeenCalled();
    expect(onViolation).not.toHaveBeenCalled();

    lifecycle?.destroy?.();
    bus.emit('stats', { tech: 'hls', stats: { ts: 1_000, fps: 1 } });

    expect(onSample).not.toHaveBeenCalled();
    expect(onViolation).not.toHaveBeenCalled();
  });
});
