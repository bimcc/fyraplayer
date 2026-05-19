import { WSRawTech } from '../src/techs/tech-ws-raw.js';
import type { WSRawSource } from '../src/types.js';

const pipelineStartMock = jest.fn(async () => {});
const pipelineStopMock = jest.fn();
const fallbackStartMock = jest.fn();
const fallbackStopMock = jest.fn();

jest.mock('../src/techs/wsRaw/pipeline.js', () => ({
  WsRawPipeline: jest.fn().mockImplementation(() => ({
    start: pipelineStartMock,
    stop: pipelineStopMock,
    getStats: () => ({ ts: Date.now() }),
    enableMetadataExtraction: jest.fn(),
    disableMetadataExtraction: jest.fn(),
    getDetectedPrivateDataPids: () => [],
    getDetectedSeiTypes: () => []
  }))
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
});
