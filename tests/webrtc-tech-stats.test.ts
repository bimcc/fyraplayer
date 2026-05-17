import { WebRTCTech } from '../src/techs/tech-webrtc.js';

type VideoLike = {
  videoWidth: number;
  videoHeight: number;
  getVideoPlaybackQuality: () => { totalVideoFrames: number; droppedVideoFrames: number };
};

function reportFrom(stats: Array<Record<string, unknown>>): RTCStatsReport {
  const map = new Map<string, Record<string, unknown>>();
  stats.forEach((stat, index) => {
    map.set(String(stat.id ?? index), { id: String(stat.id ?? index), ...stat });
  });
  return map as unknown as RTCStatsReport;
}

describe('WebRTCTech stats and lifecycle helpers', () => {
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
});
