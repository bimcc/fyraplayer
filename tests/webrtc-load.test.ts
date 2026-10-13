import { WebRTCTech } from '../src/techs/tech-webrtc.js';
import { abortReason } from '../src/core/abort.js';
import type { Source } from '../src/types.js';

const setupMock = jest.fn();
const destroyMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../src/techs/webrtc/signalAdapter.js', () => ({
  createSignalAdapter: () => ({ setup: setupMock, destroy: destroyMock })
}));

class PeerStub {
  close = jest.fn();
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  getReceivers = () => [];
  addTransceiver = () => ({ receiver: {} });
}

describe('WebRTCTech load cancellation and cleanup', () => {
  const originalPc = globalThis.RTCPeerConnection;
  const source: Source = { type: 'webrtc', url: 'https://example.com/whep', signal: { type: 'whep', url: 'https://example.com/whep' } };
  let peers: PeerStub[];
  let video: HTMLVideoElement;
  let tech: WebRTCTech;

  beforeEach(() => {
    jest.useFakeTimers();
    setupMock.mockReset().mockResolvedValue(undefined);
    destroyMock.mockClear();
    peers = [];
    globalThis.RTCPeerConnection = jest.fn(() => { const pc = new PeerStub(); peers.push(pc); return pc; }) as unknown as typeof RTCPeerConnection;
    video = { videoWidth: 0, srcObject: null, play: jest.fn().mockResolvedValue(undefined), pause: jest.fn(), load: jest.fn(), removeAttribute: jest.fn() } as unknown as HTMLVideoElement;
    tech = new WebRTCTech();
  });

  afterEach(async () => {
    await tech.destroy();
    globalThis.RTCPeerConnection = originalPc;
    jest.useRealTimers();
  });

  test('cancels negotiation, closes peer and suppresses captured media/signaling callbacks', async () => {
    setupMock.mockImplementationOnce((_pc, _source, _events, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
    }));
    const controller = new AbortController();
    const ready = jest.fn();
    const network = jest.fn();
    tech.on('ready', ready);
    tech.on('network', network);
    const loading = tech.load(source, { video, signal: controller.signal });
    await jest.advanceTimersByTimeAsync(0);
    const lateLoadedData = video.onloadeddata!;
    const lateTrack = peers[0].ontrack!;
    const lateSignalEvent = setupMock.mock.calls[0][2];
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    lateLoadedData.call(video, new Event('loadeddata'));
    lateTrack({ track: { kind: 'video' }, streams: [{}] } as unknown as RTCTrackEvent);
    lateSignalEvent({ type: 'offer' });
    expect(peers[0].close).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(ready).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('keeps successful playback alive after load scope expires and clears every timer on destroy', async () => {
    const controller = new AbortController();
    video.playsInline = false;
    await tech.load(source, { video, signal: controller.signal });
    expect(video.playsInline).toBe(false);
    expect(jest.getTimerCount()).toBe(3);
    controller.abort();
    expect(peers[0].close).not.toHaveBeenCalled();
    const ready = jest.fn();
    tech.on('ready', ready);
    video.onloadeddata!.call(video, new Event('loadeddata'));
    expect(ready).toHaveBeenCalledTimes(1);
    await tech.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('does not create a peer for an already cancelled load', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(tech.load(source, { video, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(peers).toHaveLength(0);
    expect(setupMock).not.toHaveBeenCalled();
  });

  test('reports internal fallback before new signaling uses the replacement source', async () => {
    const next = { ...source, url: 'https://example.com/backup/whep' };
    const requested = { ...source, fallbacks: [next] };
    await tech.load(requested, { video });
    const order: string[] = [];
    tech.on('streamchange', event => {
      expect(event).toEqual({ reason: 'fallback', source: next });
      order.push('streamchange');
    });
    setupMock.mockImplementationOnce(() => { order.push('setup'); return Promise.resolve(); });
    await (tech as unknown as { handleAbrRenditionChange(event: unknown): Promise<void> }).handleAbrRenditionChange({ rendition: 'low' });
    expect(order).toEqual(['streamchange', 'setup']);
    expect(peers[0].close).toHaveBeenCalledTimes(1);
    expect(peers).toHaveLength(2);
  });

  test('does not begin an internal fallback when a streamchange listener destroys the Tech', async () => {
    await tech.load({ ...source, fallbacks: [{ ...source, url: 'https://example.com/backup/whep' }] }, { video });
    tech.on('streamchange', () => { void tech.destroy(); });
    await (tech as unknown as { handleAbrRenditionChange(event: unknown): Promise<void> }).handleAbrRenditionChange({ rendition: 'low' });
    expect(peers).toHaveLength(1);
    expect(setupMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
