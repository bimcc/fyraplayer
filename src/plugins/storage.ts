import { PluginCtor } from '../types.js';

/**
 * Storage plugin: persists last source index.
 */
const KEY = 'fyra:lastSource';

export const storagePlugin: PluginCtor = ({ player, storage }) => {
  if (!storage) return;
  try {
    const saved = storage.getItem(KEY);
    if (saved) {
      const idx = Number(saved);
      if (!Number.isNaN(idx)) {
        player.switchSource(idx).catch(() => {});
      }
    }
  } catch {
    /* ignore */
  }
  const handler = () => {
    const current = player.getCurrentSource();
    if (!current) return;
    const sources = (player as any).options?.sources ?? [];
    const index = sources.indexOf(current);
    if (index >= 0) {
      try {
        storage.setItem(KEY, String(index));
      } catch {
        /* ignore */
      }
    }
  };
  // naive hook: when play triggers, save
  (player as any).on?.('play', handler);
};
