import { MultiViewCoordinator, type MultiViewResource } from '../examples/integrations/multiview.js';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function factory(startup = Promise.resolve(), cleanup = Promise.resolve()) {
  const resources: Array<MultiViewResource & { signal?: AbortSignal; start: jest.Mock; destroy: jest.Mock }> = [];
  const create = jest.fn(() => {
    const resource = { start: jest.fn(async (signal: AbortSignal) => { resource.signal = signal; await startup; }),
      destroy: jest.fn(() => cleanup), signal: undefined as AbortSignal | undefined };
    resources.push(resource); return resource;
  });
  return { create, resources };
}

describe('application multiview scheduler', () => {
  test('bounds allocations and startup concurrency, then prioritizes focused visible tiles', async () => {
    const ready = deferred(), first = factory(ready.promise), second = factory(), third = factory();
    const coordinator = new MultiViewCoordinator({ maxActive: 2, maxStarting: 1 });
    coordinator.add({ id: 'a', create: first.create, enabled: true });
    coordinator.add({ id: 'b', create: second.create, enabled: true });
    coordinator.add({ id: 'c', create: third.create, enabled: true });
    await settle(); expect(first.create).toHaveBeenCalledTimes(1); expect(second.create).not.toHaveBeenCalled();
    ready.resolve(); await settle(); expect(coordinator.snapshot()).toMatchObject({ allocated: 2, starting: 0 });
    coordinator.focus('c'); await settle();
    expect(second.resources[0].destroy).toHaveBeenCalledTimes(1);
    expect(first.resources[0].destroy).not.toHaveBeenCalled(); expect(third.create).toHaveBeenCalledTimes(1);
    await coordinator.destroy();
  });
  test('a retiring session retains capacity until both startup and cleanup settle', async () => {
    const ready = deferred(), released = deferred(), a = factory(ready.promise, released.promise), b = factory();
    const coordinator = new MultiViewCoordinator({ maxActive: 1 });
    coordinator.add({ id: 'a', create: a.create, enabled: true }); coordinator.add({ id: 'b', create: b.create, enabled: true });
    await settle(); coordinator.focus('b'); await settle();
    expect(a.resources[0].signal?.aborted).toBe(true); expect(a.resources[0].destroy).toHaveBeenCalledTimes(1);
    released.resolve(); await settle(); expect(b.create).not.toHaveBeenCalled();
    ready.resolve(); await settle(); expect(b.create).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().allocated).toBe(1); await coordinator.destroy();
  });
  test('offscreen and background release sessions; return preserves explicit user disable', async () => {
    const a = factory(), b = factory(); const coordinator = new MultiViewCoordinator();
    coordinator.add({ id: 'a', create: a.create, enabled: true }); coordinator.add({ id: 'b', create: b.create, enabled: true });
    await settle(); coordinator.setEnabled('b', false); coordinator.setVisible('a', false); await settle();
    expect(coordinator.snapshot().allocated).toBe(0);
    coordinator.setVisible('a', true); await settle(); expect(a.create).toHaveBeenCalledTimes(2);
    coordinator.setPageVisible(false); await settle(); expect(coordinator.snapshot().allocated).toBe(0);
    coordinator.setPageVisible(true); await settle(); expect(a.create).toHaveBeenCalledTimes(3); expect(b.create).toHaveBeenCalledTimes(1);
    await coordinator.destroy();
  });
  test('startup failure does not retry-loop or block other tiles; retry is explicit', async () => {
    const fail = jest.fn(() => { throw new Error('offline'); }), good = factory();
    const coordinator = new MultiViewCoordinator({ maxActive: 1 });
    coordinator.add({ id: 'bad', create: fail, enabled: true }); coordinator.add({ id: 'ok', create: good.create, enabled: true });
    await settle(); expect(fail).toHaveBeenCalledTimes(1); expect(good.create).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().tiles[0]).toMatchObject({ state: 'error', error: 'offline' });
    coordinator.retry('bad'); await settle(); expect(fail).toHaveBeenCalledTimes(2); await coordinator.destroy();
  });
  test('aborts timed-out startup without freeing an uncooperative in-flight slot', async () => {
    jest.useFakeTimers();
    const ready = deferred(), a = factory(ready.promise), b = factory();
    const coordinator = new MultiViewCoordinator({ maxActive: 1, startupTimeoutMs: 100 });
    try {
      coordinator.add({ id: 'a', create: a.create, enabled: true }); coordinator.add({ id: 'b', create: b.create, enabled: true });
      jest.runAllTicks(); await settle(); jest.advanceTimersByTime(101); await settle(); jest.runAllTicks();
      expect(a.resources[0].signal?.aborted).toBe(true); expect(b.create).not.toHaveBeenCalled();
      ready.resolve(); await settle(); jest.runAllTicks(); await settle();
      expect(b.create).toHaveBeenCalledTimes(1);
    } finally { await coordinator.destroy(); jest.useRealTimers(); }
  });
  test('terminal playback failure releases its slot and stays failed until user retry', async () => {
    const a = factory(), b = factory(); const coordinator = new MultiViewCoordinator({ maxActive: 1 });
    coordinator.add({ id: 'a', create: a.create, enabled: true }); coordinator.add({ id: 'b', create: b.create, enabled: true });
    await settle(); coordinator.fail('a', new Error('connection closed')); await settle();
    expect(a.resources[0].destroy).toHaveBeenCalledTimes(1); expect(b.create).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().tiles[0].error).toBe('connection closed');
    coordinator.setPageVisible(false); coordinator.setPageVisible(true); await settle();
    expect(a.create).toHaveBeenCalledTimes(1); await coordinator.destroy();
  });
  test('cleanup failure quarantines capacity until explicit successful retry', async () => {
    const a = factory(), b = factory(); const coordinator = new MultiViewCoordinator({ maxActive: 1 });
    coordinator.add({ id: 'a', create: a.create, enabled: true }); coordinator.add({ id: 'b', create: b.create, enabled: true });
    await settle(); a.resources[0].destroy.mockRejectedValueOnce(new Error('release failed'));
    coordinator.setEnabled('a', false); await settle(); expect(b.create).not.toHaveBeenCalled();
    expect(coordinator.snapshot()).toMatchObject({ allocated: 1, tiles: [expect.objectContaining({ state: 'error', error: 'release failed' }), expect.anything()] });
    coordinator.retry('a'); await settle(); expect(b.create).toHaveBeenCalledTimes(1); await coordinator.destroy();
  });
  test('removal during startup cannot revive, reuse ids early, or exceed a reduced budget', async () => {
    const ready = deferred(), a = factory(ready.promise), b = factory(); const coordinator = new MultiViewCoordinator();
    coordinator.add({ id: 'a', create: a.create, enabled: true }); coordinator.add({ id: 'b', create: b.create, enabled: true });
    await settle(); coordinator.remove('a'); coordinator.setBudget(1, 1);
    expect(() => coordinator.add({ id: 'a', create: a.create })).toThrow('unique');
    ready.resolve(); await settle(); expect(coordinator.snapshot().tiles.map(t => t.id)).toEqual(['b']);
    coordinator.add({ id: 'a', create: a.create }); await settle(); expect(a.create).toHaveBeenCalledTimes(1); await coordinator.destroy();
  });
  test('destroy is idempotent, immediately aborts startup and waits for actual release', async () => {
    const ready = deferred(), a = factory(ready.promise); const coordinator = new MultiViewCoordinator();
    coordinator.add({ id: 'a', create: a.create, enabled: true }); await settle();
    const destroy = coordinator.destroy(); expect(coordinator.destroy()).toBe(destroy);
    expect(a.resources[0].signal?.aborted).toBe(true); expect(a.resources[0].destroy).toHaveBeenCalledTimes(1);
    let done = false; void destroy.then(() => { done = true; }); await settle(); expect(done).toBe(false);
    ready.resolve(); await destroy; expect(coordinator.snapshot()).toMatchObject({ active: false, allocated: 0 });
    expect(() => coordinator.setEnabled('a', true)).toThrow('destroyed');
  });
  test('callback exceptions and reentrant disabling cannot leave a resource running', async () => {
    const a = factory(); const coordinator = new MultiViewCoordinator({ onChange: () => { throw new Error('reporter'); } });
    coordinator.add({ id: 'a', enabled: true, create: () => { coordinator.setEnabled('a', false); return a.create(); } });
    await settle(); expect(a.resources[0].start).not.toHaveBeenCalled(); expect(a.resources[0].destroy).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().allocated).toBe(0); await coordinator.destroy();
    for (const value of [0, -1, 1.5, 33]) expect(() => new MultiViewCoordinator({ maxActive: value })).toThrow();
  });
});
