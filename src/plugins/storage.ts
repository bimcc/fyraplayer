import { PluginCtor } from '../types.js';

/**
 * Storage plugin: persists last source index.
 */
const DEFAULT_KEY = 'fyra:lastSource';

export interface StoragePluginOptions {
  /** Storage key for persisted source index. */
  key?: string;
  /** Restore persisted source index when the plugin is applied. Defaults to true. */
  restoreSource?: boolean;
}

export function createStoragePlugin(options: StoragePluginOptions = {}): PluginCtor {
  return ({ player, storage }) => {
    if (!storage) return;
    const key = options.key ?? DEFAULT_KEY;
    const restoreSource = options.restoreSource !== false;

    if (restoreSource) {
      try {
        const saved = storage.getItem(key);
        if (saved) {
          const idx = Number(saved);
          if (Number.isInteger(idx) && idx >= 0 && idx < player.getSources().length) {
            player.switchSource(idx).catch(() => {});
          }
        }
      } catch {
        /* ignore */
      }
    }

    const handler = () => {
      const current = player.getCurrentSource();
      if (!current) return;
      const sources = player.getSources();
      const index = sources.indexOf(current);
      if (index >= 0) {
        try {
          storage.setItem(key, String(index));
        } catch {
          /* ignore */
        }
      }
    };

    player.on('play', handler);

    return {
      destroy: () => {
        player.off('play', handler);
      },
    };
  };
}

export const storagePlugin: PluginCtor = createStoragePlugin();
