import { captureSnapshot, createSnapshotPlugin, type SnapshotHandle } from '../src/plugins/snapshot.js';
import { pluginHost } from './helpers/plugin-host.js';

function fixture() {
  let encode!: BlobCallback;
  const draw = jest.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }), toBlob: jest.fn((callback: BlobCallback) => { encode = callback; }) };
  const createElement = jest.fn(() => canvas);
  const video = Object.assign(new EventTarget(), {
    videoWidth: 1920, videoHeight: 1080, readyState: 4, currentTime: 12.5,
    ownerDocument: { createElement }
  }) as unknown as HTMLVideoElement;
  return { canvas, draw, createElement, video, finish: (blob: Blob | null) => encode(blob) };
}

test('captures an aspect-preserving Blob without downloading and records the pixel-copy timestamp', async () => {
  const f = fixture();
  const capture = captureSnapshot(f.video, { maxWidth: 640, maxHeight: 480, type: 'image/jpeg', quality: 0.8 });
  expect(f.draw).toHaveBeenCalledWith(f.video, 0, 0, 640, 360);
  f.video.currentTime = 14;
  f.finish(new Blob(['image'], { type: 'image/jpeg' }));
  const result = await capture;
  expect(result).toMatchObject({ width: 640, height: 360, mediaTime: 12.5 });
  expect(result.filename).toMatch(/\.jpg$/);
  expect(f.createElement.mock.calls).toEqual([['canvas']]);
  expect(f.canvas.width).toBe(0);
});

test('rejects missing frames, invalid sizes, CORS failures and empty encodes', async () => {
  const f = fixture();
  await expect(captureSnapshot(f.video, { maxWidth: NaN })).rejects.toThrow(RangeError);
  Object.defineProperty(f.video, 'readyState', { value: 0, configurable: true });
  await expect(captureSnapshot(f.video)).rejects.toThrow('No decoded');
  Object.defineProperty(f.video, 'readyState', { value: 4 });
  f.canvas.toBlob.mockImplementationOnce(() => { throw new DOMException('tainted', 'SecurityError'); });
  await expect(captureSnapshot(f.video)).rejects.toMatchObject({ name: 'SecurityError' });
  const empty = captureSnapshot(f.video); f.finish(null);
  await expect(empty).rejects.toThrow('no image');
  expect(f.canvas.width).toBe(0);
});

test('source switch cancels old capture; destroy invalidates in-flight encoding and handles', async () => {
  const f = fixture(), host = pluginHost(f.video);
  let handle!: SnapshotHandle;
  createSnapshotPlugin({ onHandle: value => { handle = value; } })(host.context);
  const first = handle.capture();
  host.switchSource();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  f.finish(new Blob(['late']));
  const second = handle.capture();
  handle.destroy();
  await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  await expect(handle.capture()).rejects.toMatchObject({ name: 'AbortError' });
  expect(host.bus.listenerCount('sourcechange')).toBe(0);
});

test('plugin acquisition rolls back when the handle callback throws', () => {
  const f = fixture(), host = pluginHost(f.video);
  expect(() => createSnapshotPlugin({ onHandle: () => { throw new Error('application failed'); } })(host.context)).toThrow('application failed');
  expect(host.bus.listenerCount('sourcechange')).toBe(0);
});

test('timeline changes cancel encoding even when the requested URL has not changed', async () => {
  const f = fixture(), host = pluginHost(f.video);
  let handle!: SnapshotHandle;
  createSnapshotPlugin({ onHandle: value => { handle = value; } })(host.context);
  const pending = handle.capture();
  host.bus.emit('sessionchange', { epoch: 4, reason: 'discontinuity', session: null });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  handle.destroy();
  expect(host.bus.listenerCount('sessionchange')).toBe(0);
});
