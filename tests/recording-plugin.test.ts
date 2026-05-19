import {
  RecordingApiError,
  createRecordingApiPlugin,
  type RecordingApiHandle,
} from '../src/plugins/recording.js';
import type { EventBusLike, PlayerRecordingEvent, PluginContext, Source, TechName } from '../src/types.js';

type Handler = (...args: unknown[]) => void;

class BusStub implements EventBusLike {
  private readonly handlers = new Map<string, Set<Handler>>();
  readonly events: Array<{ event: string; payload?: unknown }> = [];

  on(event: string, listener: Handler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)?.add(listener);
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

  emit(event: string, payload?: unknown): void {
    this.events.push({ event, payload });
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

function createContext(bus: BusStub, source: Source = { type: 'hls', url: 'https://example.com/live.m3u8' }): PluginContext {
  const sources = [source];
  return {
    player: ({
      getCurrentSource: () => source,
      getSources: () => sources,
      getState: () => 'playing',
      getQualityState: () => ({ supported: false, auto: true, levels: [] }),
    } as unknown) as PluginContext['player'],
    coreBus: bus,
    techs: {
      getCurrentTech: () => null,
      getTech: () => null,
      getCurrentTechName: () => source.type as TechName,
      getRegisteredTechs: () => [source.type as TechName],
      register: (() => {
        throw new Error('not implemented');
      }) as PluginContext['techs']['register'],
    },
    storage: null,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('createRecordingApiPlugin', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true });
  });

  test('starts and stops backend recording through API calls and emits recording events', async () => {
    const bus = new BusStub();
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ recordingId: 'rec-1', sessionId: 's-1', status: 'recording' }))
      .mockResolvedValueOnce(jsonResponse({ recordingId: 'rec-1', sessionId: 's-1', status: 'stopped', active: false }));
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    let handle: RecordingApiHandle | undefined;
    const events: PlayerRecordingEvent[] = [];
    const lifecycle = createRecordingApiPlugin({
      startUrl: 'https://api.example.com/recordings/start',
      stopUrl: ({ recordingId }) => `https://api.example.com/recordings/${recordingId}/stop`,
      headers: ({ action }) => ({ 'x-action': action }),
      credentials: 'include',
      onHandle: (created) => {
        handle = created;
      },
      onEvent: (event) => events.push(event),
    })(createContext(bus));

    await handle?.start({ reason: 'manual' });
    expect(handle?.isRecording()).toBe(true);
    expect(handle?.getRecordingId()).toBe('rec-1');

    await handle?.stop();
    expect(handle?.isRecording()).toBe(false);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.example.com/recordings/start',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-action': 'start',
        }),
        body: expect.stringContaining('"reason":"manual"'),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.example.com/recordings/rec-1/stop',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      'recording-starting',
      'recording-started',
      'recording-stopping',
      'recording-stopped',
    ]);
    expect(bus.events.filter((event) => event.event === 'recording')).toHaveLength(4);

    lifecycle?.destroy?.();
  });

  test('queries backend status without creating a browser recorder', async () => {
    const bus = new BusStub();
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ recordingId: 'rec-2', active: true }));
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    let handle: RecordingApiHandle | undefined;
    createRecordingApiPlugin({
      startUrl: 'https://api.example.com/recordings/start',
      statusUrl: 'https://api.example.com/recordings/status',
      statusMethod: 'GET',
      onHandle: (created) => {
        handle = created;
      },
    })(createContext(bus));

    const result = await handle?.status();

    expect(result).toEqual(expect.objectContaining({ recordingId: 'rec-2', active: true }));
    expect(handle?.isRecording()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/recordings/status',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
      })
    );
  });

  test('emits error state when backend recording request fails', async () => {
    const bus = new BusStub();
    const fetchMock = jest.fn().mockResolvedValue(new Response('denied', { status: 403, statusText: 'Forbidden' }));
    Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

    let handle: RecordingApiHandle | undefined;
    const events: PlayerRecordingEvent[] = [];
    createRecordingApiPlugin({
      startUrl: 'https://api.example.com/recordings/start',
      onHandle: (created) => {
        handle = created;
      },
      onEvent: (event) => events.push(event),
    })(createContext(bus));

    await expect(handle?.start()).rejects.toThrow('HTTP 403');
    expect(handle?.isRecording()).toBe(false);
    expect(events.at(-1)).toEqual(
      expect.objectContaining({
        type: 'recording-error',
        status: 'error',
        active: false,
        code: 'RECORDING_HTTP_ERROR',
        error: expect.objectContaining({
          code: 'RECORDING_HTTP_ERROR',
          action: 'start',
          endpoint: 'https://api.example.com/recordings/start',
          status: 403,
          statusText: 'Forbidden',
          body: 'denied',
        }),
      })
    );
  });

  test('normalizes timeout and parse errors for diagnostics', async () => {
    jest.useFakeTimers();
    try {
      const bus = new BusStub();
      const fetchMock = jest.fn((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        })
      );
      Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });

      let handle: RecordingApiHandle | undefined;
      const events: PlayerRecordingEvent[] = [];
      createRecordingApiPlugin({
        startUrl: 'https://api.example.com/recordings/start',
        timeoutMs: 5,
        onHandle: (created) => {
          handle = created;
        },
        onEvent: (event) => events.push(event),
      })(createContext(bus));

      const promise = handle?.start();
      const timeoutAssertion = expect(promise).rejects.toMatchObject({
        info: expect.objectContaining({
          code: 'RECORDING_TIMEOUT',
          timeoutMs: 5,
        }),
      });
      await jest.advanceTimersByTimeAsync(6);
      await timeoutAssertion;
      expect(events.at(-1)).toEqual(
        expect.objectContaining({
          code: 'RECORDING_TIMEOUT',
          error: expect.objectContaining({ code: 'RECORDING_TIMEOUT' }),
        })
      );
    } finally {
      jest.useRealTimers();
    }

    const parseBus = new BusStub();
    const parseFetchMock = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    Object.defineProperty(globalThis, 'fetch', { value: parseFetchMock, configurable: true });
    let parseHandle: RecordingApiHandle | undefined;
    createRecordingApiPlugin({
      startUrl: 'https://api.example.com/recordings/start',
      parseResponse: () => {
        throw new Error('bad payload');
      },
      onHandle: (created) => {
        parseHandle = created;
      },
    })(createContext(parseBus));

    await expect(parseHandle?.start()).rejects.toBeInstanceOf(RecordingApiError);
    const parseEvent = parseBus.events.at(-1)?.payload as PlayerRecordingEvent;
    expect(parseEvent).toEqual(
      expect.objectContaining({
        code: 'RECORDING_PARSE_ERROR',
        error: expect.objectContaining({ code: 'RECORDING_PARSE_ERROR' }),
      })
    );
  });
});
