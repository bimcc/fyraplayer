import { FyraPlayer } from '../src/player.js';
import type { PlaybackSessionChange } from '../src/types.js';
import { mockTechInstances, resetMockTechInstances } from './mocks/tech-base.js';

const video = () => ({ currentTime: 0, readyState: 0, load() {}, addEventListener() {}, removeEventListener() {} }) as unknown as HTMLVideoElement;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

beforeEach(() => resetMockTechInstances());
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('session identifies patched fallback source before ready and preserves requested source', async () => {
  const player = new FyraPlayer({ video: video(), sources: [{ type: 'hls', url: 'primary', fallbacks: [{ type: 'hls', url: 'backup' }] }],
    reconnect: { enabled: false }, middleware: [{ kind: 'request', fn: () => ({ url: 'signed-primary' }) }] });
  const tech = mockTechInstances.hls[0];
  const events: PlaybackSessionChange[] = [];
  player.on('sessionchange', event => events.push(event));
  const readySources: string[] = [];
  player.on('ready', () => readySources.push(player.getPlaybackSession()!.source.url));
  jest.spyOn(tech, 'load').mockImplementation(async source => {
    if (source.url === 'signed-primary') throw new Error('offline');
    tech.emit('ready');
  });
  await player.init();
  expect(readySources).toEqual(['backup']);
  expect(player.getCurrentSource()?.url).toBe('primary');
  expect(player.getPlaybackSession()).toMatchObject({ source: { url: 'backup' }, requestedSource: { url: 'primary' }, status: 'loaded' });
  expect(events.filter(e => e.reason === 'selected').map(e => e.session?.source.url)).toEqual(['signed-primary', 'backup']);
  const epoch = player.getPlaybackSession()!.epoch;
  tech.emit('streamchange', { reason: 'discontinuity' });
  expect(player.getPlaybackSession()!.epoch).toBeGreaterThan(epoch);
  expect(events.at(-1)?.reason).toBe('discontinuity');
  await player.destroy();
  expect(player.getPlaybackSession()).toBeNull();
});

test('reentrant session observers can replace a selected source before Tech.load starts', async () => {
  const player = new FyraPlayer({ video: video(), sources: [{ type: 'hls', url: 'a' }, { type: 'hls', url: 'b' }] });
  let replaced: Promise<void> | undefined;
  player.on('sessionchange', event => {
    if (event.reason === 'selected' && event.session?.source.url === 'a') replaced = player.switchSource(1);
  });
  await player.init(); await replaced;
  expect(mockTechInstances.hls[0].loadCalls).toBe(1);
  expect(player.getPlaybackSession()?.source.url).toBe('b');
  await player.destroy();
});

test('switch aborts a hanging middleware step without waiting for its late result', async () => {
  let entered!: () => void, release!: (value: { url: string }) => void;
  const started = new Promise<void>(done => { entered = done; });
  let signal!: AbortSignal;
  const player = new FyraPlayer({ video: video(), sources: [{ type: 'hls', url: 'a' }, { type: 'hls', url: 'b' }], middleware: [{ kind: 'request', fn: ctx => {
    if (ctx.url === 'a') { signal = ctx.signal!; entered(); return new Promise(resolve => { release = resolve; }); }
  } }] });
  const init = player.init(); await started;
  await player.switchSource(1); await init;
  expect(signal.aborted).toBe(true);
  expect(player.getPlaybackSession()?.source.url).toBe('b');
  release({ url: 'late' }); await tick();
  expect(mockTechInstances.hls[0].loadCalls).toBe(1);
  await player.destroy();
});

test('cooperative Tech timeout tries same-Tech backup with a fresh signal and clears timers', async () => {
  jest.useFakeTimers();
  const player = new FyraPlayer({ video: video(), loadTimeoutMs: 20, reconnect: { enabled: false },
    sources: [{ type: 'hls', url: 'a', fallbacks: [{ type: 'hls', url: 'b' }] }] });
  const tech = mockTechInstances.hls[0];
  const signals: AbortSignal[] = [];
  jest.spyOn(tech, 'load').mockImplementation(async (source, opts) => {
    signals.push(opts!.signal!);
    if (source.url === 'a') await new Promise<void>((_resolve, reject) => {
      opts!.signal!.addEventListener('abort', () => reject(opts!.signal!.reason), { once: true });
    });
    else tech.emit('ready');
  });
  const init = player.init();
  await jest.advanceTimersByTimeAsync(21); await init;
  expect(signals.map(s => s.aborted)).toEqual([true, false]);
  expect(signals[0].reason.name).toBe('TimeoutError');
  expect(player.getPlaybackSession()?.source.url).toBe('b');
  await player.destroy();
  expect(jest.getTimerCount()).toBe(0);
});

test('destroy aborts a cooperative Tech load and middleware timeouts report TimeoutError', async () => {
  const player = new FyraPlayer({ video: video(), sources: [{ type: 'hls', url: 'a' }] });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  jest.spyOn(mockTechInstances.hls[0], 'load').mockImplementation(async (_source, opts) => {
    await new Promise<void>((_resolve, reject) => {
      opts!.signal!.addEventListener('abort', () => reject(opts!.signal!.reason), { once: true });
      entered();
    });
  });
  const init = player.init(); await started; await player.destroy(); await init;
  expect(player.getPlaybackSession()).toBeNull();
  jest.useFakeTimers();
  const timed = new FyraPlayer({ video: video(), loadTimeoutMs: 10, reconnect: { enabled: false }, sources: [{ type: 'hls', url: 'a' }],
    middleware: [{ kind: 'request', fn: () => new Promise(() => {}) }] });
  const error = jest.fn(); timed.on('error', error);
  const pending = timed.init(); await jest.advanceTimersByTimeAsync(11); await pending;
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ name: 'TimeoutError' }));
  expect(timed.getState()).toBe('error');
  await timed.destroy(); expect(jest.getTimerCount()).toBe(0);
});

test('core reconnect invalidates the old session even when it reloads the same URL', async () => {
  jest.useFakeTimers();
  const player = new FyraPlayer({ video: video(), sources: [{ type: 'hls', url: 'a' }],
    reconnect: { enabled: true, baseDelayMs: 1, maxDelayMs: 1, jitter: 0 } });
  await player.init();
  const old = player.getPlaybackSession()!;
  const events: PlaybackSessionChange[] = [];
  player.on('sessionchange', event => events.push(event));
  mockTechInstances.hls[0].emit('network', { type: 'disconnected', fatal: true });
  await jest.advanceTimersByTimeAsync(2);
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'reconnect', session: null })]));
  expect(player.getPlaybackSession()!.epoch).toBeGreaterThan(old.epoch);
  await player.destroy(); expect(jest.getTimerCount()).toBe(0);
});
