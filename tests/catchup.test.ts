import { applyCatchUp } from '../src/techs/wsRaw/catchup.js';

type TestFrame = {
  pts: number;
  isKey: boolean;
  data: Uint8Array;
  track: 'video';
  codec: 'h264';
};

function frame(pts: number, isKey = false): TestFrame {
  return {
    pts,
    isKey,
    data: new Uint8Array([1]),
    track: 'video',
    codec: 'h264'
  };
}

describe('wsRaw/catchup applyCatchUp', () => {
  test('returns original frames when mode is none', () => {
    const frames = [frame(0, true), frame(40), frame(80)];
    const result = applyCatchUp(frames as any, {
      mode: 'none',
      latestPts: 80,
      maxBufferMs: 20,
      maxFrames: 1
    });

    expect(result.frames).toHaveLength(3);
    expect(result.dropped).toBe(0);
    expect(result.event).toBeUndefined();
  });

  test('latest mode keeps only newest frame when oversized', () => {
    const frames = [frame(0, true), frame(40), frame(80), frame(120)];
    const result = applyCatchUp(frames as any, {
      mode: 'latest',
      latestPts: 120,
      maxBufferMs: 30,
      maxFrames: 2
    });

    expect(result.frames).toHaveLength(1);
    expect(result.frames[0].pts).toBe(120);
    expect(result.dropped).toBe(3);
    expect(result.event).toMatchObject({ type: 'catchup', mode: 'latest', dropped: 3, kept: 1 });
  });

  test('drop-to-key mode keeps from latest keyframe', () => {
    const frames = [frame(0), frame(40), frame(80, true), frame(120)];
    const result = applyCatchUp(frames as any, {
      mode: 'drop-to-key',
      latestPts: 120,
      maxBufferMs: 30,
      maxFrames: 2
    });

    expect(result.frames.map((f) => f.pts)).toEqual([80, 120]);
    expect(result.dropped).toBe(2);
    expect(result.event).toMatchObject({ type: 'catchup', mode: 'drop-to-key', dropped: 2, kept: 2 });
  });

  test('drop-bp mode keeps keyframes and partial predictive frames', () => {
    const frames = [frame(0, true), frame(40), frame(80), frame(120, true), frame(160)];
    const result = applyCatchUp(frames as any, {
      mode: 'drop-bp',
      latestPts: 160,
      maxBufferMs: 10,
      maxFrames: 2
    });

    expect(result.frames.length).toBeLessThan(frames.length);
    expect(result.frames.some((f) => f.isKey)).toBe(true);
    expect(result.dropped).toBe(frames.length - result.frames.length);
    expect(result.event?.mode).toBe('drop-bp');
  });
});

