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

  appendBuffer(data: ArrayBuffer): void {
    if (this.appendError) {
      throw this.appendError;
    }
    this.appended.push(data);
  }

  remove(start: number, end: number): void {
    this.removed.push([start, end]);
    this.updating = true;
  }
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
