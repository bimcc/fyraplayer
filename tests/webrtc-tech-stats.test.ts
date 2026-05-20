import { WebRTCTech } from '../src/techs/tech-webrtc.js';

type VideoLike = {
  videoWidth: number;
  videoHeight: number;
  getVideoPlaybackQuality: () => { totalVideoFrames: number; droppedVideoFrames: number };
};

type PeerConnectionStub = Pick<RTCPeerConnection, 'getReceivers'> & {
  ontrack: ((event: RTCTrackEvent) => void) | null;
};

type PeerConnectionStateStub = Pick<RTCPeerConnection, 'getReceivers'> & {
  ontrack: ((event: RTCTrackEvent) => void) | null;
  onconnectionstatechange: (() => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  restartIce?: jest.Mock<void, []>;
};

type PeerConnectionConfigStub = Pick<RTCPeerConnection, 'getConfiguration' | 'setConfiguration'>;

function reportFrom(stats: Array<Record<string, unknown>>): RTCStatsReport {
  const map = new Map<string, Record<string, unknown>>();
  stats.forEach((stat, index) => {
    map.set(String(stat.id ?? index), { id: String(stat.id ?? index), ...stat });
  });
  return map as unknown as RTCStatsReport;
}

describe('WebRTCTech stats and lifecycle helpers', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('falls back to video element resolution when RTC track stats omit dimensions', async () => {
    const tech = new WebRTCTech();
    const video = {
      videoWidth: 1280,
      videoHeight: 720,
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 300, droppedVideoFrames: 2 }),
    } as VideoLike as HTMLVideoElement;

    (tech as unknown as { video: HTMLVideoElement }).video = video;
    (tech as unknown as { pc: Pick<RTCPeerConnection, 'getStats'> }).pc = {
      getStats: async () =>
        reportFrom([
          {
            id: 'inbound-video',
            type: 'inbound-rtp',
            kind: 'video',
            bytesReceived: 100_000,
            framesDecoded: 30,
            framesDropped: 1,
            packetsReceived: 120,
            packetsLost: 0,
          },
        ]),
    };

    const stats = await (
      tech as unknown as { computeRtcStats: () => Promise<Record<string, unknown>> }
    ).computeRtcStats();

    expect(stats).toEqual(
      expect.objectContaining({
        width: 1280,
        height: 720,
        droppedFrames: 1,
        framesDropped: 1,
        framesDecoded: 30,
        packetLoss: 0,
      })
    );
  });

  test('reports audio RTP and selected ICE candidate details in stats', async () => {
    const tech = new WebRTCTech();
    const video = {
      videoWidth: 1920,
      videoHeight: 1080,
      getVideoPlaybackQuality: () => ({ totalVideoFrames: 600, droppedVideoFrames: 3 }),
    } as VideoLike as HTMLVideoElement;

    (tech as unknown as { video: HTMLVideoElement }).video = video;
    (tech as unknown as { pc: Pick<RTCPeerConnection, 'getStats'> }).pc = {
      getStats: async () =>
        reportFrom([
          {
            id: 'pair',
            type: 'candidate-pair',
            state: 'succeeded',
            currentRoundTripTime: 0.012,
            localCandidateId: 'local',
            remoteCandidateId: 'remote',
          },
          { id: 'local', type: 'local-candidate', candidateType: 'relay', protocol: 'tcp' },
          { id: 'remote', type: 'remote-candidate', candidateType: 'relay', protocol: 'udp' },
          {
            id: 'inbound-video',
            type: 'inbound-rtp',
            kind: 'video',
            bytesReceived: 300_000,
            framesDecoded: 60,
            packetsReceived: 240,
            packetsLost: 1,
          },
          {
            id: 'inbound-audio',
            type: 'inbound-rtp',
            kind: 'audio',
            bytesReceived: 12_000,
            packetsReceived: 180,
            packetsLost: 0,
            jitter: 0.004,
          },
        ]),
    };

    const stats = await (
      tech as unknown as { computeRtcStats: () => Promise<Record<string, unknown>> }
    ).computeRtcStats();

    expect(stats).toEqual(
      expect.objectContaining({
        candidateType: 'relay',
        localCandidateType: 'relay',
        remoteCandidateType: 'relay',
        transport: 'tcp',
        rttMs: 12,
        jitterMs: 4,
        audioBytesReceived: 12_000,
        audioPacketsReceived: 180,
        audioPacketsLost: 0,
      })
    );
  });

  test('applies source ICE servers to existing WHEP peer connection config', () => {
    const tech = new WebRTCTech();
    const network = jest.fn();
    const getConfiguration = jest.fn(() => ({ iceTransportPolicy: 'all' as RTCIceTransportPolicy }));
    const setConfiguration = jest.fn();
    const pc: PeerConnectionConfigStub = { getConfiguration, setConfiguration };
    const iceServers: RTCIceServer[] = [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }];

    tech.on('network', network);
    (tech as unknown as { pc: PeerConnectionConfigStub }).pc = pc;
    (tech as unknown as { applySourceIceConfig: (source: unknown) => void }).applySourceIceConfig({
      type: 'webrtc',
      url: 'https://example.com/live/whep',
      iceServers,
      forceRelay: true,
    });

    expect(setConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        iceServers,
        iceTransportPolicy: 'relay',
      })
    );
    expect(network).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ice-config',
        serverCount: 1,
        forceRelay: true,
      })
    );
  });

  test('emits ready only once across multiple readiness signals', () => {
    const tech = new WebRTCTech();
    const ready = jest.fn();

    tech.on('ready', ready);

    const exposed = tech as unknown as { emitReadyOnce: () => void };
    exposed.emitReadyOnce();
    exposed.emitReadyOnce();

    expect(ready).toHaveBeenCalledTimes(1);
  });

  test('clears video callbacks and media source on destroy', async () => {
    const tech = new WebRTCTech();
    const pause = jest.fn();
    const load = jest.fn();
    const removeAttribute = jest.fn();
    const video = {
      onloadedmetadata: jest.fn(),
      onloadeddata: jest.fn(),
      onerror: jest.fn(),
      pause,
      load,
      removeAttribute,
      srcObject: {} as MediaStream,
    } as unknown as HTMLVideoElement;

    (tech as unknown as { video: HTMLVideoElement }).video = video;

    await tech.destroy();

    expect(video.onloadedmetadata).toBeNull();
    expect(video.onloadeddata).toBeNull();
    expect(video.onerror).toBeNull();
    expect(video.srcObject).toBeNull();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(removeAttribute).toHaveBeenCalledWith('src');
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('does not force WebRTC media element muted during autoplay', () => {
    const tech = new WebRTCTech();
    const play = jest.fn(() => Promise.resolve());
    const stream = {} as MediaStream;
    const video = {
      srcObject: null,
      muted: false,
      play,
    } as unknown as HTMLVideoElement;
    const pc: PeerConnectionStub = {
      ontrack: null,
      getReceivers: () => [],
    };

    (tech as unknown as { video: HTMLVideoElement }).video = video;
    (tech as unknown as { pc: PeerConnectionStub }).pc = pc;
    (tech as unknown as { bindTracks: () => void }).bindTracks();

    pc.ontrack?.({
      track: { kind: 'video' } as MediaStreamTrack,
      receiver: {} as RTCRtpReceiver,
      transceiver: { receiver: {} as RTCRtpReceiver } as RTCRtpTransceiver,
      streams: [stream],
    } as unknown as RTCTrackEvent);

    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);
  });

  test('emits warning when a live WebRTC audio track remains browser-muted', () => {
    jest.useFakeTimers();
    const tech = new WebRTCTech();
    const network = jest.fn();
    const track = {
      kind: 'audio',
      muted: true,
      readyState: 'live',
    } as MediaStreamTrack;

    tech.on('network', network);
    (tech as unknown as { monitorAudioTrack: (track: MediaStreamTrack) => void }).monitorAudioTrack(track);
    jest.advanceTimersByTime(3000);

    expect(network).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'webrtc-audio-muted',
        severity: 'warning',
      })
    );
  });

  test('reconnects through player reload when ICE disconnected does not recover', () => {
    jest.useFakeTimers();
    const tech = new WebRTCTech();
    const network = jest.fn();
    const restartIce = jest.fn();
    const pc: PeerConnectionStateStub = {
      ontrack: null,
      onconnectionstatechange: null,
      oniceconnectionstatechange: null,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      restartIce,
      getReceivers: () => [],
    };

    tech.on('network', network);
    (tech as unknown as { pc: PeerConnectionStateStub }).pc = pc;
    (tech as unknown as { reconnect: { baseDelayMs: number } }).reconnect = { baseDelayMs: 900 };
    (tech as unknown as { bindTracks: () => void }).bindTracks();

    pc.iceConnectionState = 'disconnected';
    pc.oniceconnectionstatechange?.();
    jest.advanceTimersByTime(899);

    expect(restartIce).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);

    expect(restartIce).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledWith(expect.objectContaining({ type: 'ice-state', state: 'disconnected' }));
    expect(network).toHaveBeenCalledWith(expect.objectContaining({ type: 'ice-restart', reason: 'ice-disconnected' }));
    expect(network).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ice-reconnect-required',
        fatal: true,
        reason: 'ice-disconnected',
        state: 'disconnected',
      })
    );
  });

  test('cancels pending ICE reconnect when ICE recovers before the grace period', () => {
    jest.useFakeTimers();
    const tech = new WebRTCTech();
    const network = jest.fn();
    const restartIce = jest.fn();
    const pc: PeerConnectionStateStub = {
      ontrack: null,
      onconnectionstatechange: null,
      oniceconnectionstatechange: null,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      restartIce,
      getReceivers: () => [],
    };

    tech.on('network', network);
    (tech as unknown as { pc: PeerConnectionStateStub }).pc = pc;
    (tech as unknown as { reconnect: { baseDelayMs: number } }).reconnect = { baseDelayMs: 900 };
    (tech as unknown as { bindTracks: () => void }).bindTracks();

    pc.iceConnectionState = 'disconnected';
    pc.oniceconnectionstatechange?.();
    jest.advanceTimersByTime(400);
    pc.iceConnectionState = 'connected';
    pc.oniceconnectionstatechange?.();
    jest.advanceTimersByTime(1000);

    expect(restartIce).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ice-reconnect-required' }));
  });

  test('emits fatal ICE failure without relying on restartIce-only recovery', () => {
    const tech = new WebRTCTech();
    const network = jest.fn();
    const restartIce = jest.fn();
    const pc: PeerConnectionStateStub = {
      ontrack: null,
      onconnectionstatechange: null,
      oniceconnectionstatechange: null,
      connectionState: 'connected',
      iceConnectionState: 'connected',
      restartIce,
      getReceivers: () => [],
    };

    tech.on('network', network);
    (tech as unknown as { pc: PeerConnectionStateStub }).pc = pc;
    (tech as unknown as { bindTracks: () => void }).bindTracks();

    pc.iceConnectionState = 'failed';
    pc.oniceconnectionstatechange?.();

    expect(network).toHaveBeenCalledWith(expect.objectContaining({ type: 'ice-state', state: 'failed' }));
    expect(network).toHaveBeenCalledWith(expect.objectContaining({ type: 'ice-failed', fatal: true }));
    expect(restartIce).not.toHaveBeenCalled();
  });
});
