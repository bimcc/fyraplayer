import { createPlaybackHealthPlugin, type PlaybackHealthHandle, type PlaybackHealthEvent } from '../src/plugins/playback-health.js';
import type { PlaybackSession } from '../src/types.js';
import { pluginHost } from './helpers/plugin-host.js';

function fixture(frames = true, modern = true) {
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  let id = 0;
  const visibility = Object.assign(new EventTarget(), { hidden: false });
  const target = Object.assign(new EventTarget(), { currentTime: 0, readyState: 4, videoWidth: 320, videoHeight: 200,
    seeking: false, ended: false, paused: true, ownerDocument: visibility,
    requestVideoFrameCallback: frames ? (callback: VideoFrameRequestCallback) => { callbacks.set(++id, callback); return id; } : undefined,
    cancelVideoFrameCallback: (value: number) => { callbacks.delete(value); } });
  const video = target as unknown as HTMLVideoElement;
  const host = pluginHost(video);
  let session: PlaybackSession | null = null;
  Object.assign(host.context.player, { getState: () => 'idle', ...(modern ? { getPlaybackSession: () => session } : {}) });
  const controller = new AbortController();
  host.context.lifecycle = { signal: controller.signal, onCleanup() {} };
  const change = (reason: import('../src/types.js').PlaybackSessionChange['reason'], epoch: number, loaded = false) => {
    session = ['selected', 'loaded', 'discontinuity', 'fallback'].includes(reason)
      ? { epoch, status: loaded ? 'loaded' : 'loading', tech: 'file', source: { type: 'file', url: 'actual.mp4' }, requestedSource: { type: 'file', url: 'requested.mp4' } } : null;
    host.bus.emit('sessionchange', { reason, epoch, session });
  };
  const frame = (time: number) => {
    const callback = [...callbacks.values()][0]; callbacks.clear();
    if (!callback) throw new Error('No scheduled frame');
    callback(performance.now(), { mediaTime: time, width: 320, height: 200, presentedFrames: ++id } as VideoFrameCallbackMetadata);
  };
  return { ...host, video, target, callbacks, visibility, controller, change, frame };
}
beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });
const advance = (ms: number) => jest.advanceTimersByTime(ms);

test('first frame uses observed frame evidence, fallback selection preserves the loading start and loaded does not reset it', () => {
  const f = fixture(), events: PlaybackHealthEvent[] = []; let h!: PlaybackHealthHandle;
  createPlaybackHealthPlugin({ onHandle: value => { h = value; }, onEvent: e => events.push(e) })(f.context);
  f.change('load', 1); advance(100); f.change('selected', 2); advance(100);
  f.bus.emit('ready'); expect(h.snapshot().firstFrameMs).toBeUndefined();
  f.change('failed', 3); advance(50); f.change('selected', 4); advance(100); f.frame(0);
  expect(h.snapshot()).toMatchObject({ firstFrameMs: 350, sessionEpoch: 4, precision: 'video-frame', source: { url: 'actual.mp4' } });
  f.change('loaded', 4, true); f.frame(0.04);
  expect(events.filter(e => e.type === 'first-frame')).toHaveLength(1);
  h.destroy(); expect(f.callbacks.size).toBe(0);
});

test('frame gaps have bounded episodes and recover only on changed frame progress, not playing/ready events', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  const qos = jest.fn(); f.bus.on('qos', qos);
  createPlaybackHealthPlugin({ stallThresholdMs: 500, checkIntervalMs: 100, onHandle: value => { h = value; } })(f.context);
  f.change('load', 1); f.change('selected', 2); f.change('loaded', 2, true); f.frame(1); f.bus.emit('play');
  advance(600); expect(h.snapshot()).toMatchObject({ status: 'stalled', stallCount: 1, stall: { reason: 'frame-gap', startedAt: 0 } });
  f.video.dispatchEvent(new Event('playing')); f.bus.emit('ready'); f.frame(1); advance(100);
  expect(h.snapshot().stallCount).toBe(1); expect(h.snapshot().status).toBe('stalled');
  f.frame(1.04); expect(h.snapshot()).toMatchObject({ status: 'playing', totalStallMs: 700 });
  expect(qos.mock.calls.map(call => call[0].code)).toEqual(['PLAYBACK_STALL', 'PLAYBACK_RECOVERED']);
  expect(h.snapshot().recent.at(-1)).toMatchObject({ type: 'stall-end', endReason: 'progress', durationMs: 700 });
  h.destroy();
});

test('explicit waiting is media evidence, interruption by pause does not count as successful recovery', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  createPlaybackHealthPlugin({ stallThresholdMs: 500, checkIntervalMs: 100, onHandle: value => { h = value; } })(f.context);
  f.change('selected', 1); f.frame(1); f.bus.emit('play'); advance(100); f.video.dispatchEvent(new Event('waiting')); advance(500);
  expect(h.snapshot().stall?.reason).toBe('media-wait'); f.bus.emit('pause'); advance(3000);
  expect(h.snapshot()).toMatchObject({ status: 'paused', stallCount: 1, totalStallMs: 500 });
  expect(h.snapshot().recent.some(e => e.endReason === 'progress')).toBe(false);
  f.bus.emit('play'); advance(400); expect(h.snapshot().stall).toBeUndefined(); f.frame(1.1); h.destroy();
});

test('pause, seeking, hidden document and application suspension suppress freeze checks and restart the observation window', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  createPlaybackHealthPlugin({ stallThresholdMs: 500, checkIntervalMs: 100, onHandle: value => { h = value; } })(f.context);
  f.change('selected', 1); f.change('loaded', 1, true); f.frame(1);
  advance(2000); expect(h.snapshot().stallCount).toBe(0); f.bus.emit('play');
  f.target.seeking = true; f.video.dispatchEvent(new Event('seeking')); advance(2000);
  expect(h.snapshot().status).toBe('seeking');
  f.target.seeking = false; f.video.dispatchEvent(new Event('seeked')); f.frame(2);
  f.visibility.hidden = true; f.visibility.dispatchEvent(new Event('visibilitychange')); advance(2000);
  expect(h.snapshot()).toMatchObject({ status: 'suspended', suspendedReason: 'document-hidden', stallCount: 0 });
  f.visibility.hidden = false; f.visibility.dispatchEvent(new Event('visibilitychange'));
  h.setSuspended(true); advance(2000); expect(h.snapshot().suspendedReason).toBe('application');
  h.setSuspended(false); advance(400); expect(h.snapshot().stallCount).toBe(0); f.frame(3); h.destroy();
});

test('strict mode does not invent frame observations; media-event fallback labels reduced precision', () => {
  const strict = fixture(false); let h!: PlaybackHealthHandle;
  createPlaybackHealthPlugin({ fallback: 'none', stallThresholdMs: 500, checkIntervalMs: 100, onHandle: value => { h = value; } })(strict.context);
  strict.change('selected', 1); strict.bus.emit('play'); advance(1000);
  expect(h.snapshot()).toMatchObject({ precision: 'unavailable', stallCount: 0 });
  strict.video.dispatchEvent(new Event('waiting')); advance(500); expect(h.snapshot().stall?.reason).toBe('media-wait'); h.destroy();
  const fallback = fixture(false);
  createPlaybackHealthPlugin({ onHandle: value => { h = value; } })(fallback.context);
  fallback.change('selected', 1); fallback.target.currentTime = 1; fallback.video.dispatchEvent(new Event('timeupdate'));
  expect(h.snapshot()).toMatchObject({ precision: 'media-event', firstFrameMs: 0, mediaTime: 1 }); h.destroy();
});

test('external renderer progress requires a matching epoch and clears old state across discontinuity/stop', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  createPlaybackHealthPlugin({ frameSource: 'external', onHandle: value => { h = value; } })(f.context);
  f.change('selected', 1); expect(h.reportFrame({ mediaTime: 5 })).toBe(false);
  expect(h.reportFrame({ mediaTime: 5, sessionEpoch: 1 })).toBe(true); f.bus.emit('play');
  f.change('discontinuity', 2, true); expect(h.snapshot().mediaTime).toBeUndefined();
  expect(h.reportFrame({ mediaTime: 6, sessionEpoch: 1 })).toBe(false);
  expect(h.reportFrame({ mediaTime: 1, sessionEpoch: 2 })).toBe(true);
  f.change('stop', 3); expect(h.reportFrame({ mediaTime: 2, sessionEpoch: 3 })).toBe(false);
  expect(h.snapshot().status).toBe('stopped'); expect(f.callbacks.size).toBe(0); h.destroy();
});

test('reconnect measures until the new observed frame and old callbacks cannot revive an obsolete session', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  createPlaybackHealthPlugin({ onHandle: value => { h = value; } })(f.context);
  f.change('selected', 1); f.frame(1); const stale = [...f.callbacks.values()][0];
  f.change('reconnect', 2); advance(200); f.change('selected', 3); advance(300);
  stale(performance.now(), { mediaTime: 99 } as VideoFrameCallbackMetadata);
  expect(h.snapshot().mediaTime).toBeUndefined(); f.frame(2);
  expect(h.snapshot()).toMatchObject({ firstFrameMs: 500, recoveryMs: 500, sessionEpoch: 3 }); h.destroy();
});

test('autoplay denial is paused without a stall; fatal transport evidence is classified separately from unknown error', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  createPlaybackHealthPlugin({ onHandle: value => { h = value; } })(f.context);
  f.change('selected', 1); f.bus.emit('play'); f.bus.emit('network', { code: 'AUTOPLAY_BLOCKED' }); advance(3000);
  expect(h.snapshot()).toMatchObject({ status: 'paused', stallCount: 0, lastError: { kind: 'autoplay' } });
  f.bus.emit('error', new Error('unclassified')); expect(h.snapshot().lastError?.kind).toBe('unknown');
  f.bus.emit('network', { fatal: true, code: 'WEBTRANSPORT_CLOSE', message: 'closed' });
  expect(h.snapshot()).toMatchObject({ status: 'error', lastError: { kind: 'transport', code: 'WEBTRANSPORT_CLOSE' } }); h.destroy();
});

test('event history copies are bounded, consumer errors and reentrant destruction cannot leave callbacks/timers running', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  const onError = jest.fn();
  createPlaybackHealthPlugin({ maxEvents: 2, onHandle: value => { h = value; }, onEvent: () => { throw new Error('consumer'); }, onError })(f.context);
  f.change('selected', 1); f.frame(1); f.bus.emit('play'); f.bus.emit('pause');
  expect(h.snapshot().recent).toHaveLength(2); h.snapshot().recent[0].status = 'error';
  expect(h.snapshot().recent[0].status).not.toBe('error'); expect(onError).toHaveBeenCalled();
  f.controller.abort(); expect(h.snapshot().active).toBe(false); expect(f.callbacks.size).toBe(0); expect(jest.getTimerCount()).toBe(0);
  expect(f.bus.listenerCount('play')).toBe(0); h.destroy();
});

test('legacy hosts still reset on sourcechange and setup failure cleans resources without Player teardown', () => {
  const f = fixture(true, false); let h!: PlaybackHealthHandle;
  createPlaybackHealthPlugin({ onHandle: value => { h = value; } })(f.context); f.frame(1); f.switchSource();
  expect(h.snapshot().mediaTime).toBeUndefined(); f.bus.emit('ready'); f.frame(2); h.destroy();
  const failed = fixture();
  expect(() => createPlaybackHealthPlugin({ onHandle: () => { throw new Error('setup'); } })(failed.context)).toThrow('setup');
  expect(failed.callbacks.size).toBe(0); expect(failed.bus.listenerCount('play')).toBe(0); expect(jest.getTimerCount()).toBe(0);
});

test('a delayed observer tick excludes the unobserved interval instead of diagnosing background freeze', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  let now = 0; const time = jest.spyOn(performance, 'now').mockImplementation(() => now);
  try {
    createPlaybackHealthPlugin({ stallThresholdMs: 500, checkIntervalMs: 100, onHandle: value => { h = value; } })(f.context);
    f.change('selected', 1); f.frame(1); f.bus.emit('play');
    now = 600; advance(100); expect(h.snapshot().stallCount).toBe(1);
    now = 10000; advance(100);
    expect(h.snapshot()).toMatchObject({ status: 'playing', stallCount: 1, totalStallMs: 600 });
    expect(h.snapshot().recent.at(-1)).toMatchObject({ type: 'observation-gap', durationMs: 9400 }); h.destroy();
  } finally { time.mockRestore(); }
});

test('a consumer can stop or destroy during a stall notification without stale QoS or a running watchdog', () => {
  const f = fixture(); let h!: PlaybackHealthHandle;
  const qos = jest.fn(); f.bus.on('qos', qos);
  createPlaybackHealthPlugin({ stallThresholdMs: 500, checkIntervalMs: 100, onHandle: value => { h = value; },
    onEvent: event => { if (event.type === 'stall') f.change('stop', 2); } })(f.context);
  f.change('selected', 1); f.frame(1); f.bus.emit('play'); advance(600);
  expect(h.snapshot().status).toBe('stopped'); expect(qos).not.toHaveBeenCalled(); expect(jest.getTimerCount()).toBe(0); h.destroy();
  const second = fixture();
  createPlaybackHealthPlugin({ stallThresholdMs: 500, checkIntervalMs: 100, onHandle: value => { h = value; },
    onEvent: event => { if (event.type === 'stall') h.destroy(); } })(second.context);
  second.change('selected', 1); second.frame(1); second.bus.emit('play'); advance(600);
  expect(h.snapshot().active).toBe(false); expect(second.callbacks.size).toBe(0); expect(jest.getTimerCount()).toBe(0);
});
