import { PluginManager } from '../src/core/pluginManager.js';
import type { PluginContext, PluginCtor, PluginFailure } from '../src/types.js';
import { FyraPlayer } from '../src/player.js';
import { mockTechInstances, resetMockTechInstances } from './mocks/tech-base.js';

const context = {} as PluginContext;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('plugins dispose in reverse installation order with lifecycle receiver intact', async () => {
  const manager = new PluginManager();
  const order: string[] = [];
  class Service {
    constructor(private readonly name: string) {}
    destroy() { order.push(this.name); }
  }
  const first = jest.fn(() => new Service('provider'));
  const second: PluginCtor = ({ lifecycle }) => {
    lifecycle!.onCleanup(() => { order.push('first resource'); });
    lifecycle!.onCleanup(() => { order.push('second resource'); });
    return new Service('consumer');
  };
  manager.register(first);
  manager.register(second);
  manager.applyAll(context);
  manager.applyAll(context);
  await manager.unregisterAll();
  expect(first).toHaveBeenCalledTimes(1);
  expect(order).toEqual(['consumer', 'second resource', 'first resource', 'provider']);
  expect(manager.count()).toBe(0);
});

test('failed setup rolls back scoped resources and reports failures without stopping other plugins', async () => {
  const failures: PluginFailure[] = [];
  const manager = new PluginManager(failure => failures.push(failure));
  const cleaned = jest.fn();
  let signal!: AbortSignal;
  manager.register(function failed({ lifecycle }) {
    signal = lifecycle!.signal;
    lifecycle!.onCleanup(cleaned);
    lifecycle!.onCleanup(() => { throw new Error('cleanup error'); });
    throw new Error('setup error');
  });
  const healthy = jest.fn(() => ({ destroy: cleaned }));
  manager.register(healthy);
  manager.applyAll(context);
  expect(signal.aborted).toBe(true);
  expect(healthy).toHaveBeenCalledTimes(1);
  await manager.unregisterAll();
  expect(cleaned).toHaveBeenCalledTimes(2);
  expect(failures.map(f => [f.plugin, f.phase])).toEqual([['failed', 'setup'], ['failed', 'cleanup']]);
});

test('concurrent teardown waits for all plugins and individually unregistering does not double destroy', async () => {
  const manager = new PluginManager();
  const gate = deferred();
  const cleaned = jest.fn();
  const first = () => ({ destroy: cleaned });
  const second = () => ({ destroy: async () => { await gate.promise; cleaned(); } });
  manager.register(first); manager.register(second); manager.applyAll(context);
  const removed = manager.unregister(second);
  const all = manager.unregisterAll();
  expect(manager.unregisterAll()).toBe(all);
  let done = false;
  void all.then(() => { done = true; });
  await Promise.resolve();
  expect(done).toBe(false);
  gate.resolve();
  await Promise.all([all, removed]);
  expect(cleaned).toHaveBeenCalledTimes(2);
});

test('player aborts plugin work immediately even while final Tech teardown waits for loading', async () => {
  resetMockTechInstances();
  const started = deferred(), release = deferred();
  let signal!: AbortSignal;
  const cleaned = jest.fn();
  const video = { load() {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLVideoElement;
  const player = new FyraPlayer({ video, sources: [{ type: 'hls', url: 'a' }], plugins: [ctx => {
    signal = ctx.lifecycle!.signal;
    ctx.lifecycle!.onCleanup(cleaned);
  }] });
  jest.spyOn(mockTechInstances.hls[0], 'load').mockImplementation(async () => { started.resolve(); await release.promise; });
  const loading = player.init();
  await started.promise;
  const destroyed = player.destroy();
  expect(signal.aborted).toBe(true);
  expect(cleaned).not.toHaveBeenCalled();
  release.resolve();
  await Promise.all([loading, destroyed]);
  expect(cleaned).toHaveBeenCalledTimes(1);
});
