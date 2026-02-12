import { PluginCtor, PluginContext, PluginLifecycle } from '../types.js';

/** Plugin instance with optional destroy method */
interface PluginInstance {
  plugin: PluginCtor;
  context?: PluginContext;
  destroy?: () => void | Promise<void>;
}

export class PluginManager {
  private plugins: PluginInstance[] = [];

  private isPluginLifecycle(value: unknown): value is PluginLifecycle {
    return typeof value === 'object' && value !== null && 'destroy' in value;
  }

  register(plugin: PluginCtor): void {
    this.plugins.push({ plugin });
  }

  /**
   * Unregister a plugin by reference.
   * If the plugin has been applied and has a destroy method, it will be called.
   */
  async unregister(plugin: PluginCtor): Promise<void> {
    const index = this.plugins.findIndex(p => p.plugin === plugin);
    if (index >= 0) {
      const instance = this.plugins[index];
      // Call destroy if available
      if (instance.destroy) {
        try {
          await instance.destroy();
        } catch (err) {
          console.warn('[plugin] destroy error', err);
        }
      }
      this.plugins.splice(index, 1);
    }
  }

  /**
   * Unregister all plugins and call their destroy methods.
   */
  async unregisterAll(): Promise<void> {
    for (const instance of this.plugins) {
      if (instance.destroy) {
        try {
          await instance.destroy();
        } catch (err) {
          console.warn('[plugin] destroy error', err);
        }
      }
    }
    this.plugins = [];
  }

  /**
   * Get the number of registered plugins
   */
  count(): number {
    return this.plugins.length;
  }

  applyAll(ctx: PluginContext): void {
    for (const instance of this.plugins) {
      try {
        // Store context for potential cleanup
        instance.context = ctx;
        
        // Call plugin - plugins may return an object with destroy method
        const result = instance.plugin(ctx);
        if (this.isPluginLifecycle(result) && typeof result.destroy === 'function') {
          instance.destroy = result.destroy;
        }
      } catch (err) {
        console.warn('[plugin] apply error', err);
      }
    }
  }
}
