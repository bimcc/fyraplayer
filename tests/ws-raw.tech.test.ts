import { WSRawTech } from '../src/techs/tech-ws-raw.js';
import type { WSRawSource } from '../src/types.js';

const pipelineStartMock = jest.fn(async () => {});
const pipelineStopMock = jest.fn();
const fallbackStartMock = jest.fn();
const fallbackStopMock = jest.fn();
let pipelineCallbacks: { onFallback: (reason: string) => void; onMetadata?: (event: unknown) => void };

jest.mock('../src/techs/wsRaw/pipeline.js', () => ({
  WsRawPipeline: jest.fn().mockImplementation((_source: unknown, _video: unknown, _buffer: unknown, callbacks: typeof pipelineCallbacks) => {
    pipelineCallbacks = callbacks;
    return {
    start: pipelineStartMock,
    stop: pipelineStopMock,
    getStats: () => ({ ts: Date.now() }),
    enableMetadataExtraction: jest.fn(),
    disableMetadataExtraction: jest.fn(),
    getDetectedPrivateDataPids: () => [],
    getDetectedSeiTypes: () => []
    };
  })
}));

jest.mock('../src/techs/wsRaw/mseFallback.js', () => ({
  MseFallback: jest.fn().mockImplementation(() => ({
    start: fallbackStartMock,
    stop: fallbackStopMock
  }))
}));

function createVideoStub(): HTMLVideoElement {
  return {
    play: async () => {},
    pause: () => {},
    srcObject: null,
    src: ''
  } as unknown as HTMLVideoElement;
}

function createSource(overrides: Partial<WSRawSource> = {}): WSRawSource {
  return {
    type: 'ws-raw',
    url: 'https://media.example.com/live.flv',
    codec: 'h264',
    transport: 'flv',
    ...overrides
  };
}

describe('WSRawTech commercial pipeline contract', () => {
  test('MSE startup cancels and experimental fallback announces its timeline before data', async () => {
    const tech = new WSRawTech();
    const change = jest.fn(), metadata = jest.fn();
    tech.on('streamchange', change); tech.on('metadata', metadata);
    await tech.load(createSource({ pipeline: 'experimental', transport: 'ts', metadata: { privateData: { enable: true } } }), { video: createVideoStub() });
    pipelineCallbacks.onMetadata?.({ type: 'private-data' });
    const controller = new AbortController();
    pipelineCallbacks.onFallback('decode failed');
    await Promise.resolve();
    expect(change).toHaveBeenCalledWith(expect.objectContaining({ reason: 'fallback', source: expect.objectContaining({ pipeline: 'mse' }) }));
    pipelineCallbacks.onMetadata?.({ type: 'private-data' });
    expect(metadata).toHaveBeenCalledTimes(1);
    await tech.destroy();
    fallbackStartMock.mockImplementationOnce(() => new Promise(() => {}));
    const loading = tech.load(createSource(), { video: createVideoStub(), signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(fallbackStopMock).toHaveBeenCalled();
  });

  beforeEach(() => {
    pipelineStartMock.mockReset();
    pipelineStopMock.mockReset();
    fallbackStartMock.mockReset();
    fallbackStopMock.mockReset();
  });

  test('uses MSE fallback by default as the stable path', async () => {
    const tech = new WSRawTech();
    await tech.load(createSource(), { video: createVideoStub() });

    expect(pipelineStartMock).not.toHaveBeenCalled();
    expect(fallbackStartMock).toHaveBeenCalledTimes(1);
    expect(fallbackStartMock.mock.calls[0][0]).toBe('https://media.example.com/live.flv');
  });

  test('uses experimental pipeline when pipeline option opts in', async () => {
    const tech = new WSRawTech();
    await tech.load(createSource({ pipeline: 'experimental', url: 'wss://media.example.com/live.ts', transport: 'ts' }), {
      video: createVideoStub()
    });

    expect(pipelineStartMock).toHaveBeenCalledTimes(1);
    expect(fallbackStartMock).not.toHaveBeenCalled();
  });

  test('falls back to MSE when experimental pipeline startup fails', async () => {
    pipelineStartMock.mockRejectedValueOnce(new Error('decode init failed'));

    const tech = new WSRawTech();
    await tech.load(createSource({ pipeline: 'experimental', url: 'wss://media.example.com/live.ts', transport: 'ts' }), {
      video: createVideoStub()
    });

    expect(pipelineStartMock).toHaveBeenCalledTimes(1);
    expect(pipelineStopMock).toHaveBeenCalledTimes(1);
    expect(fallbackStartMock).toHaveBeenCalledTimes(1);
    expect(fallbackStartMock.mock.calls[0][0]).toBe('wss://media.example.com/live.ts');
  });

  test('background fallback failures emit fatal events and stopped pipelines cannot restart fallback', async () => {
    const tech = new WSRawTech();
    const error = jest.fn(), network = jest.fn();
    tech.on('error', error);
    tech.on('network', network);
    await tech.load(createSource({ pipeline: 'experimental' }), { video: createVideoStub() });
    fallbackStartMock.mockRejectedValueOnce(new Error('MSE unavailable'));
    pipelineCallbacks.onFallback('decode failed');
    await new Promise(resolve => setImmediate(resolve));
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'MSE unavailable' }));
    expect(network).toHaveBeenCalledWith({ type: 'ws-fallback-error', fatal: true });
    await tech.destroy();
    pipelineCallbacks.onFallback('late callback');
    expect(fallbackStartMock).toHaveBeenCalledTimes(1);
  });
});
