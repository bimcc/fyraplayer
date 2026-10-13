import { createFrameClockPlugin, mediaTimeToPts90k, type FrameClockHandle, type FrameClockSample } from '../src/plugins/frame-clock.js';
import { pluginHost } from './helpers/plugin-host.js';

function fixture(withFrames = true) {
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  let id = 0;
  const target = Object.assign(new EventTarget(), {
    currentTime: 99, videoWidth: 1920, videoHeight: 1080, readyState: 4, seeking: false,
    requestVideoFrameCallback: withFrames ? jest.fn((callback: VideoFrameRequestCallback) => { callbacks.set(++id, callback); return id; }) : undefined,
    cancelVideoFrameCallback: jest.fn((value: number) => { callbacks.delete(value); })
  });
  const video = target as unknown as HTMLVideoElement;
  return { video, callbacks, host: pluginHost(video) };
}
const metadata = (time: number) => ({ mediaTime: time, width: 1920, height: 1080, presentedFrames: 12, expectedDisplayTime: 201 }) as VideoFrameCallbackMetadata;

test('uses displayed frame mediaTime instead of currentTime and invalidates cancelled callbacks at source changes', () => {
  const { video, host, callbacks } = fixture();
  let handle!: FrameClockHandle;
  const samples: FrameClockSample[] = [];
  createFrameClockPlugin({ onHandle: value => { handle = value; }, onFrame: frame => samples.push(frame) })(host.context);
  const first = callbacks.get(1)!;
  callbacks.delete(1); first(200, metadata(3.25));
  expect(handle.getLatest()).toMatchObject({ mediaTime: 3.25, precision: 'video-frame', epoch: 0 });
  const stale = callbacks.get(2)!;
  host.switchSource();
  expect(handle.getLatest()).toBeNull();
  stale(220, metadata(3.5));
  expect(samples).toHaveLength(1);
  host.bus.emit('ready');
  expect(callbacks.size).toBe(1);
  const next = [...callbacks.values()][0]; callbacks.clear(); next(240, metadata(0.1));
  expect(handle.getLatest()).toMatchObject({ epoch: 1, source: { url: 'b.mp4' } });
  video.dispatchEvent(new Event('seeking'));
  expect(handle.getLatest()).toBeNull();
  video.dispatchEvent(new Event('seeked'));
  expect(callbacks.size).toBe(1);
  handle.destroy(); handle.destroy();
  expect(callbacks.size).toBe(0);
  expect(host.bus.listenerCount('ready')).toBe(0);
  expect(handle.getLatest()).toBeNull();
});

test('older browsers expose reduced precision and strict mode does not fabricate frame times', () => {
  const { video, host } = fixture(false);
  const sample = jest.fn();
  const plugin = createFrameClockPlugin({ onFrame: sample })(host.context)!;
  video.dispatchEvent(new Event('timeupdate'));
  expect(sample).toHaveBeenCalledWith(expect.objectContaining({ mediaTime: 99, precision: 'media-event' }));
  plugin.destroy!(); sample.mockClear();
  const strict = createFrameClockPlugin({ fallback: 'none', onFrame: sample })(host.context)!;
  video.dispatchEvent(new Event('timeupdate'));
  expect(sample).not.toHaveBeenCalled();
  strict.destroy!();
});

test('abort stops scheduling, and consumer errors cannot stop the next frame callback', () => {
  const { host, callbacks } = fixture();
  const controller = new AbortController();
  host.context.lifecycle = { signal: controller.signal, onCleanup() {} };
  const onError = jest.fn(() => { throw new Error('reporter failed'); });
  createFrameClockPlugin({ onFrame: () => { throw new Error('view failed'); }, onError })(host.context);
  const callback = callbacks.get(1)!; callbacks.clear(); callback(100, metadata(1));
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'view failed' }));
  expect(callbacks.size).toBe(1);
  controller.abort();
  expect(callbacks.size).toBe(0);
  expect(host.bus.listenerCount('sourcechange')).toBe(0);
});

test('explicit timeline mapping preserves bigint origin and rejects invalid media times', () => {
  expect(mediaTimeToPts90k(12.5, { mediaTime: 10, pts90k: 9000000000000000n })).toBe(9000000000225000n);
  expect(mediaTimeToPts90k(9.5, { mediaTime: 10, pts90k: 90000n })).toBe(45000n);
  expect(() => mediaTimeToPts90k(NaN, { mediaTime: 0, pts90k: 0n })).toThrow(RangeError);
  expect(() => mediaTimeToPts90k(1e20, { mediaTime: 0, pts90k: 0n })).toThrow(RangeError);
});

test('reported session replacements reset the clock and samples identify the actual source', () => {
  const { host, callbacks } = fixture();
  let session: import('../src/types.js').PlaybackSession | null = { epoch: 1, status: 'loaded', tech: 'file',
    requestedSource: { type: 'file', url: 'requested.mp4' }, source: { type: 'file', url: 'backup.mp4' } };
  host.context.player.getPlaybackSession = () => session;
  let handle!: FrameClockHandle;
  createFrameClockPlugin({ onHandle: value => { handle = value; } })(host.context);
  const callback = callbacks.get(1)!; callbacks.clear(); callback(1, metadata(1));
  expect(handle.getLatest()).toMatchObject({ source: { url: 'backup.mp4' }, sessionEpoch: 1 });
  const stale = [...callbacks.values()][0];
  session = null;
  host.bus.emit('sessionchange', { epoch: 2, reason: 'reconnect', session });
  stale(2, metadata(2));
  host.bus.emit('ready');
  expect(handle.getLatest()).toBeNull();
  expect(callbacks.size).toBe(0);
  session = { epoch: 3, status: 'loaded', tech: 'file', requestedSource: { type: 'file', url: 'requested.mp4' }, source: { type: 'file', url: 'new.mp4' } };
  host.bus.emit('sessionchange', { epoch: 3, reason: 'selected', session });
  expect(callbacks.size).toBe(1);
  handle.destroy();
});
