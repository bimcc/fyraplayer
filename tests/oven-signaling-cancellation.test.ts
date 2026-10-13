import { OvenSignaling } from '../src/techs/webrtc/ovenSignaling.js';
import { createSignalAdapter } from '../src/techs/webrtc/signalAdapter.js';

class SocketStub {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: ((event: { wasClean: boolean; code: number; reason: string }) => void) | null = null;
  send = jest.fn();
  close = jest.fn();
  open() { this.readyState = 1; this.onopen?.(); }
}

describe('OME signaling cancellation', () => {
  const originalSocket = globalThis.WebSocket;
  const originalDescription = globalThis.RTCSessionDescription;
  const config = { type: 'oven-ws' as const, url: 'ws://example.com/app/live', streamId: 'live' };
  let sockets: SocketStub[];

  beforeEach(() => {
    jest.useFakeTimers();
    sockets = [];
    globalThis.WebSocket = jest.fn(() => { const socket = new SocketStub(); sockets.push(socket); return socket; }) as unknown as typeof WebSocket;
    globalThis.RTCSessionDescription = jest.fn(description => description) as unknown as typeof RTCSessionDescription;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    globalThis.WebSocket = originalSocket;
    globalThis.RTCSessionDescription = originalDescription;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('aborts pending connection and prevents late open from requesting an offer', async () => {
    const controller = new AbortController();
    const events = jest.fn();
    const signaling = new OvenSignaling(config, events);
    const loading = signaling.connect(controller.signal);
    const lateOpen = sockets[0].onopen!;
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    lateOpen();
    expect(sockets[0].close).toHaveBeenCalledTimes(1);
    expect(sockets[0].send).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('rejects a connection closed before opening', async () => {
    const signaling = new OvenSignaling(config);
    const loading = signaling.connect();
    sockets[0].onclose!({ wasClean: true, code: 1000, reason: '' });
    await expect(loading).rejects.toThrow('before opening');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('destroy cancels offer waiting and clears its timer', async () => {
    const signaling = new OvenSignaling(config);
    const connecting = signaling.connect();
    sockets[0].open();
    await connecting;
    const loading = signaling.waitOffer();
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(jest.getTimerCount()).toBe(1);
    await signaling.destroy();
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });

  test('setup waits for SDP application and destroy stops a late offer continuation', async () => {
    let complete!: () => void;
    const pc = {
      setRemoteDescription: jest.fn(() => new Promise<void>(resolve => { complete = resolve; })),
      createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'answer' }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined)
    };
    const adapter = createSignalAdapter(config);
    const events = jest.fn();
    const loading = adapter.setup(pc as unknown as RTCPeerConnection, { type: 'webrtc', url: config.url }, events);
    const rejected = expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    sockets[0].open();
    // Deliver the offer before connect() has resumed: it must not be lost.
    sockets[0].onmessage!({ data: JSON.stringify({ command: 'offer', id: 'session', peer_id: 'peer', sdp: 'offer' }) });
    await jest.advanceTimersByTimeAsync(0);
    expect(pc.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(pc.createAnswer).not.toHaveBeenCalled();
    await adapter.destroy();
    await rejected;
    complete();
    await Promise.resolve();
    expect(pc.createAnswer).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'answer-sent' }));
    expect(jest.getTimerCount()).toBe(0);
  });

  test('accepts an immediate offer and resolves setup after sending its answer', async () => {
    const pc = {
      setRemoteDescription: jest.fn().mockResolvedValue(undefined),
      createAnswer: jest.fn().mockResolvedValue({ type: 'answer', sdp: 'answer' }),
      setLocalDescription: jest.fn().mockResolvedValue(undefined)
    };
    const adapter = createSignalAdapter(config);
    const loading = adapter.setup(pc as unknown as RTCPeerConnection, { type: 'webrtc', url: config.url });
    sockets[0].open();
    sockets[0].onmessage!({ data: JSON.stringify({ command: 'offer', id: 'session', sdp: 'offer' }) });
    await loading;
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer' });
    expect(sockets[0].send).toHaveBeenCalledWith(expect.stringContaining('"command":"answer"'));
    expect(jest.getTimerCount()).toBe(0);
    await adapter.destroy();
  });
});
