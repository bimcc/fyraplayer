import { FMP4Tech } from '../src/techs/tech-fmp4.js';
import type { BufferPolicy } from '../src/types.js';

type Fmp4TechHarness = {
  sourceBuffer: SourceBuffer | null;
  mediaSource: MediaSource | null;
  video: HTMLVideoElement | null;
  buffer?: BufferPolicy;
  pendingBuffers: unknown[];
  pendingBytes: number;
  appendBuffer(data: ArrayBuffer): void;
  flushPendingBuffers(): void;
  on(event: string, handler: (event: unknown) => void): void;
};

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit?]>;

class FakeTimeRanges {
  constructor(private readonly ranges: Array<[number, number]>) {}

  get length(): number {
    return this.ranges.length;
  }

  start(index: number): number {
    return this.ranges[index][0];
  }

  end(index: number): number {
    return this.ranges[index][1];
  }
}

class FakeSourceBuffer {
  public updating = false;
  public appended: ArrayBuffer[] = [];
  public removed: Array<[number, number]> = [];
  public buffered = new FakeTimeRanges([[0, 60]]);
  public appendError: Error | null = null;
  public mode: 'segments' | 'sequence' = 'segments';
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, handler: () => void): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  private emit(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) handler();
  }

  appendBuffer(data: ArrayBuffer): void {
    if (this.appendError) {
      throw this.appendError;
    }
    this.appended.push(data);
    this.updating = false;
    queueMicrotask(() => this.emit('updateend'));
  }

  remove(start: number, end: number): void {
    this.removed.push([start, end]);
    this.updating = true;
  }
}

class FakeMediaSource {
  public readyState: 'closed' | 'open' | 'ended' = 'closed';
  public sourceBuffer = new FakeSourceBuffer();
  public addedMimeTypes: string[] = [];
  static supportedMimeTypes: Set<string> | null = null;
  private listeners = new Map<string, Array<() => void>>();

  static isTypeSupported(mimeType: string): boolean {
    return FakeMediaSource.supportedMimeTypes ? FakeMediaSource.supportedMimeTypes.has(mimeType) : true;
  }

  addEventListener(type: string, handler: () => void): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
    if (type === 'sourceopen') {
      queueMicrotask(() => {
        this.readyState = 'open';
        this.emit('sourceopen');
      });
    }
  }

  addSourceBuffer(mimeType: string): SourceBuffer {
    this.addedMimeTypes.push(mimeType);
    return this.sourceBuffer as unknown as SourceBuffer;
  }

  removeSourceBuffer(): void {
    this.sourceBuffer = new FakeSourceBuffer();
  }

  endOfStream(): void {
    this.readyState = 'ended';
  }

  private emit(type: string): void {
    for (const handler of this.listeners.get(type) ?? []) handler();
  }
}

function installBrowserFmp4Mocks(): void {
  FakeMediaSource.supportedMimeTypes = null;
  (globalThis as unknown as { MediaSource: typeof MediaSource }).MediaSource = FakeMediaSource as unknown as typeof MediaSource;
  (globalThis as unknown as { URL: typeof URL }).URL = {
    ...URL,
    createObjectURL: jest.fn(() => 'blob:fmp4-test'),
    revokeObjectURL: jest.fn()
  } as unknown as typeof URL;
}

function createReadableFetch(chunks: Uint8Array[], options?: { neverDone?: boolean }): FetchMock {
  const queue = [...chunks];
  const reader = {
    read: jest.fn(() => {
      const value = queue.shift();
      if (value) {
        return Promise.resolve({ value, done: false });
      }
      if (options?.neverDone) {
        return new Promise<ReadableStreamReadResult<Uint8Array>>(() => {});
      }
      return Promise.resolve({ value: undefined, done: true });
    }),
    releaseLock: jest.fn()
  };

  return jest.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    body: {
      getReader: () => reader
    }
  }) as unknown as Response);
}

function createTech(options?: {
  sourceBuffer?: FakeSourceBuffer;
  currentTime?: number;
  buffer?: BufferPolicy;
}): { tech: Fmp4TechHarness; sourceBuffer: FakeSourceBuffer; network: unknown[]; errors: unknown[]; buffers: unknown[] } {
  const tech = new FMP4Tech() as unknown as Fmp4TechHarness;
  const sourceBuffer = options?.sourceBuffer ?? new FakeSourceBuffer();
  tech.sourceBuffer = sourceBuffer as unknown as SourceBuffer;
  tech.mediaSource = { readyState: 'open' } as MediaSource;
  tech.video = {
    currentTime: options?.currentTime ?? 30,
    videoWidth: 1920,
    videoHeight: 1080
  } as HTMLVideoElement;
  tech.buffer = options?.buffer;

  const network: unknown[] = [];
  const errors: unknown[] = [];
  const buffers: unknown[] = [];
  tech.on('network', (event) => network.push(event));
  tech.on('error', (event) => errors.push(event));
  tech.on('buffer', (event) => buffers.push(event));

  return { tech, sourceBuffer, network, errors, buffers };
}

function quotaError(): Error {
  const error = new Error('quota');
  error.name = 'QuotaExceededError';
  return error;
}

describe('FMP4Tech backpressure and quota policy', () => {
  afterEach(() => {
    FakeMediaSource.supportedMimeTypes = null;
    jest.restoreAllMocks();
  });

  test('resolves HTTP load after response headers and keeps streaming chunks in the background', async () => {
    const originalMediaSource = (globalThis as unknown as { MediaSource?: typeof MediaSource }).MediaSource;
    const originalUrl = globalThis.URL;
    const originalFetch = globalThis.fetch;
    installBrowserFmp4Mocks();
    const fetchMock = createReadableFetch([new Uint8Array([1, 2, 3])], { neverDone: true });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    const tech = new FMP4Tech();
    const readyEvents: unknown[] = [];
    tech.on('ready', (event) => readyEvents.push(event));
    const video = {
      src: '',
      srcObject: null,
      load: jest.fn(),
      videoWidth: 0,
      videoHeight: 0,
      currentTime: 0
    } as unknown as HTMLVideoElement;

    try {
      await expect(tech.load({
        type: 'fmp4',
        url: 'https://example.com/live/fmp4',
        transport: 'http',
        codec: 'h264',
        preferTech: 'fmp4'
      }, { video })).resolves.toBeUndefined();

      await Promise.resolve();
      const mediaSource = (tech as unknown as { mediaSource: FakeMediaSource }).mediaSource;
      expect(readyEvents).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledWith('https://example.com/live/fmp4', expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(mediaSource.sourceBuffer.appended).toHaveLength(1);
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
      (globalThis as unknown as { MediaSource?: typeof MediaSource }).MediaSource = originalMediaSource;
      (globalThis as unknown as { URL: typeof URL }).URL = originalUrl;
      await tech.destroy();
    }
  });

  test('selects a supported H.265 MIME candidate before creating SourceBuffer', async () => {
    const originalMediaSource = (globalThis as unknown as { MediaSource?: typeof MediaSource }).MediaSource;
    const originalUrl = globalThis.URL;
    const originalFetch = globalThis.fetch;
    installBrowserFmp4Mocks();
    const supported = 'video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"';
    FakeMediaSource.supportedMimeTypes = new Set([supported]);
    const fetchMock = createReadableFetch([new Uint8Array([1])], { neverDone: true });
    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    const tech = new FMP4Tech();
    const network: unknown[] = [];
    tech.on('network', (event) => network.push(event));
    const video = {
      src: '',
      srcObject: null,
      load: jest.fn(),
      videoWidth: 0,
      videoHeight: 0,
      currentTime: 0
    } as unknown as HTMLVideoElement;

    try {
      await tech.load({
        type: 'fmp4',
        url: 'https://example.com/live/hevc.fmp4',
        transport: 'http',
        codec: 'h265',
        preferTech: 'fmp4'
      }, { video });

      const mediaSource = (tech as unknown as { mediaSource: FakeMediaSource }).mediaSource;
      expect(mediaSource.addedMimeTypes).toEqual([supported]);
      expect(network).toContainEqual({ type: 'fmp4-codec-selected', mimeType: supported });
    } finally {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
      (globalThis as unknown as { MediaSource?: typeof MediaSource }).MediaSource = originalMediaSource;
      (globalThis as unknown as { URL: typeof URL }).URL = originalUrl;
      await tech.destroy();
    }
  });

  test('fails fast with explicit diagnostics when fMP4 MIME candidates are unsupported', async () => {
    const originalMediaSource = (globalThis as unknown as { MediaSource?: typeof MediaSource }).MediaSource;
    const originalUrl = globalThis.URL;
    installBrowserFmp4Mocks();
    FakeMediaSource.supportedMimeTypes = new Set();
    const tech = new FMP4Tech();
    const network: unknown[] = [];
    const errors: unknown[] = [];
    tech.on('network', (event) => network.push(event));
    tech.on('error', (event) => errors.push(event));
    const video = {
      src: '',
      srcObject: null,
      load: jest.fn(),
      videoWidth: 0,
      videoHeight: 0,
      currentTime: 0
    } as unknown as HTMLVideoElement;

    try {
      await expect(tech.load({
        type: 'fmp4',
        url: 'https://example.com/live/hevc.fmp4',
        transport: 'http',
        codec: 'h265',
        preferTech: 'fmp4'
      }, { video })).rejects.toThrow('MIME type not supported for fMP4 source');

      expect(network).toEqual([
        expect.objectContaining({
          type: 'fmp4-codec-unsupported',
          codec: 'h265',
          fatal: true
        })
      ]);
      expect(errors).toEqual(network);
    } finally {
      (globalThis as unknown as { MediaSource?: typeof MediaSource }).MediaSource = originalMediaSource;
      (globalThis as unknown as { URL: typeof URL }).URL = originalUrl;
      await tech.destroy();
    }
  });

  test('drops oldest queued segments when pending queue exceeds the configured segment limit', () => {
    const { tech, sourceBuffer, network, buffers } = createTech({
      buffer: { fmp4: { maxPendingSegments: 2, maxPendingBytes: Number.MAX_SAFE_INTEGER } }
    });
    sourceBuffer.updating = true;

    tech.appendBuffer(new ArrayBuffer(1));
    tech.appendBuffer(new ArrayBuffer(1));
    tech.appendBuffer(new ArrayBuffer(1));

    expect(sourceBuffer.appended).toHaveLength(0);
    expect(tech.pendingBuffers).toHaveLength(2);
    expect(tech.pendingBytes).toBe(2);
    expect(network).toEqual([
      expect.objectContaining({
        type: 'fmp4-backpressure',
        severity: 'warning',
        dropped: 1,
        droppedBytes: 1,
        pendingSegments: 2,
        pendingBytes: 2,
        maxPendingSegments: 2,
        strategy: 'drop-oldest'
      })
    ]);
    expect(buffers).toEqual([
      expect.objectContaining({
        pendingSegments: 2,
        pendingBytes: 2,
        dropped: 1
      })
    ]);
  });

  test('can fail fast on pending queue overflow when configured with error strategy', () => {
    const { tech, sourceBuffer, network, errors } = createTech({
      buffer: { fmp4: { maxPendingSegments: 1, maxPendingBytes: Number.MAX_SAFE_INTEGER, overflowStrategy: 'error' } }
    });
    sourceBuffer.updating = true;

    tech.appendBuffer(new ArrayBuffer(1));
    tech.appendBuffer(new ArrayBuffer(1));

    expect(tech.pendingBuffers).toHaveLength(1);
    expect(tech.pendingBytes).toBe(1);
    expect(network).toEqual([
      expect.objectContaining({
        type: 'fmp4-backpressure',
        strategy: 'error',
        dropped: 1
      })
    ]);
    expect(errors).toEqual([
      expect.objectContaining({
        type: 'fmp4-backpressure',
        pendingSegments: 1,
        pendingBytes: 1
      })
    ]);
  });

  test('requeues a segment and removes old buffered media after SourceBuffer quota errors', () => {
    const { tech, sourceBuffer, network } = createTech({
      currentTime: 40,
      buffer: { fmp4: { quotaCleanupKeepBehindMs: 10_000, quotaRetryLimit: 1 } }
    });
    sourceBuffer.appendError = quotaError();

    tech.appendBuffer(new ArrayBuffer(3));

    expect(sourceBuffer.appended).toHaveLength(0);
    expect(tech.pendingBuffers).toHaveLength(1);
    expect(tech.pendingBytes).toBe(3);
    expect(sourceBuffer.removed).toEqual([[0, 30]]);
    expect(network).toEqual([
      expect.objectContaining({
        type: 'fmp4-quota-exceeded',
        severity: 'warning',
        attempt: 1,
        maxRetries: 1
      })
    ]);
  });

  test('drops quota-failing segment after retry budget is exhausted', () => {
    const { tech, sourceBuffer, network, errors } = createTech({
      currentTime: 5,
      buffer: { fmp4: { quotaRetryLimit: 0 } }
    });
    sourceBuffer.appendError = quotaError();

    tech.appendBuffer(new ArrayBuffer(4));

    expect(tech.pendingBuffers).toHaveLength(0);
    expect(tech.pendingBytes).toBe(0);
    expect(errors).toHaveLength(0);
    expect(network).toEqual([
      expect.objectContaining({
        type: 'fmp4-quota-exceeded',
        attempt: 1,
        maxRetries: 0
      }),
      expect.objectContaining({
        type: 'fmp4-backpressure',
        strategy: 'quota-retry-exhausted',
        dropped: 1,
        droppedBytes: 4
      })
    ]);
  });
});
