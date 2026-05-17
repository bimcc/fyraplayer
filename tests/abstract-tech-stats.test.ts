import { AbstractTech } from '../src/techs/abstractTech.js';
import type { BufferPolicy, MetricsOptions, ReconnectPolicy, Source } from '../src/types.js';

type VideoLike = {
  videoWidth: number;
  videoHeight: number;
  getVideoPlaybackQuality: () => { totalVideoFrames: number; droppedVideoFrames: number };
};

class TestTech extends AbstractTech {
  canPlay(): boolean {
    return true;
  }

  async load(
    source: Source,
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
    }
  ): Promise<void> {
    this.source = source;
    this.video = opts.video;
  }
}

describe('AbstractTech stats', () => {
  test('reports fps as a frame-rate sample instead of cumulative frames', async () => {
    const tech = new TestTech();
    let totalVideoFrames = 100;
    const video = {
      videoWidth: 1280,
      videoHeight: 720,
      getVideoPlaybackQuality: () => ({ totalVideoFrames, droppedVideoFrames: 2 }),
    } as VideoLike as HTMLVideoElement;

    const now = jest.spyOn(Date, 'now');
    await tech.load({ type: 'hls', url: 'https://example.com/stream.m3u8' }, { video });

    now.mockReturnValueOnce(1_000);
    const first = tech.getStats();
    expect(first.fps).toBeUndefined();

    totalVideoFrames = 130;
    now.mockReturnValueOnce(2_000);
    const second = tech.getStats();

    expect(second).toEqual(
      expect.objectContaining({
        ts: 2_000,
        width: 1280,
        height: 720,
        droppedFrames: 2,
        fps: 30,
      })
    );

    now.mockRestore();
  });
});
