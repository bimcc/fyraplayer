import type { PluginCtor, PluginContext, PluginFailure, PluginLifecycle, PluginScope } from '../types.js';

interface PluginInstance {
  plugin: PluginCtor;
  applied: boolean;
  controller: AbortController;
  cleanups: Array<() => void | Promise<void>>;
  lifecycle?: PluginLifecycle;
  disposal?: Promise<void>;
}

export class PluginManager {
  private plugins: PluginInstance[] = [];
  private readonly pending = new Set<Promise<void>>();
  private teardown: Promise<void> | null = null;

  constructor(private readonly onError?: (failure: PluginFailure) => void) {}

  register(plugin: PluginCtor): void {
    this.plugins.push({ plugin, applied: false, controller: new AbortController(), cleanups: [] });
  }

  private report(instance: PluginInstance, phase: PluginFailure['phase'], error: unknown): void {
    const failure = { plugin: instance.plugin.name || 'anonymous', phase, error };
    try {
      if (this.onError) this.onError(failure);
      else console.warn(`[plugin] ${phase} error`, failure);
    } catch (reportError) {
      console.warn('[plugin] error reporter failed', reportError);
    }
  }

  private dispose(instance: PluginInstance): Promise<void> {
    if (instance.disposal) return instance.disposal;
    // Assign before abort/cleanup, since user callbacks may re-enter the manager.
    instance.disposal = Promise.resolve().then(async () => {
      if (instance.lifecycle?.destroy) {
        try { await instance.lifecycle.destroy(); }
        catch (error) { this.report(instance, 'destroy', error); }
      }
      for (const cleanup of instance.cleanups.splice(0).reverse()) {
        try { await cleanup(); }
        catch (error) { this.report(instance, 'cleanup', error); }
      }
    });
    this.pending.add(instance.disposal);
    instance.controller.abort();
    void instance.disposal.then(() => this.pending.delete(instance.disposal!));
    return instance.disposal;
  }

  async unregister(plugin: PluginCtor): Promise<void> {
    const index = this.plugins.findIndex(instance => instance.plugin === plugin);
    if (index < 0) return;
    const [instance] = this.plugins.splice(index, 1);
    await this.dispose(instance);
  }

  /** Stop cooperative work immediately, without racing final Tech teardown. */
  deactivateAll(): void {
    for (const instance of this.plugins) instance.controller.abort();
  }

  unregisterAll(): Promise<void> {
    if (this.teardown) return this.teardown;
    const instances = this.plugins.splice(0).reverse();
    this.teardown = Promise.resolve().then(async () => {
      // Consumers are destroyed before the providers installed earlier in plugins[].
      for (const instance of instances) await this.dispose(instance);
      await Promise.all([...this.pending]);
    }).finally(() => { this.teardown = null; });
    for (const instance of instances) instance.controller.abort();
    return this.teardown;
  }

  count(): number { return this.plugins.length; }

  applyAll(ctx: PluginContext): void {
    for (const instance of [...this.plugins]) {
      if (instance.applied || instance.controller.signal.aborted) continue;
      instance.applied = true;
      const scope: PluginScope = {
        signal: instance.controller.signal,
        onCleanup: cleanup => {
          if (scope.signal.aborted) throw new Error('Cannot acquire resources for an inactive plugin');
          instance.cleanups.push(cleanup);
        }
      };
      // Preserve lazy storage access instead of evaluating it with object spread.
      const scopedContext = Object.create(Object.getPrototypeOf(ctx), Object.getOwnPropertyDescriptors(ctx)) as PluginContext;
      scopedContext.lifecycle = scope;
      try {
        const result = instance.plugin(scopedContext);
        if (result && typeof result.destroy === 'function') instance.lifecycle = result;
      } catch (error) {
        this.report(instance, 'setup', error);
        void this.dispose(instance);
      }
    }
  }
}
