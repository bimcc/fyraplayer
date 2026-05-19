import { PlayerPreferenceEvent, PluginCtor, Source } from '../types.js';

/**
 * Storage plugin: persists selected playback preferences.
 */
const DEFAULT_KEY = 'fyra:lastSource';
const DEFAULT_PREFS_KEY = 'fyra:preferences';

export interface StoragePluginOptions {
  /** Storage key for persisted source index. */
  key?: string;
  /** Storage key for structured playback preferences. Defaults to `fyra:preferences`. */
  preferencesKey?: string;
  /** Restore persisted source index when the plugin is applied. Defaults to true. */
  restoreSource?: boolean;
  /** Persist and restore the last source index. Defaults to true. */
  persistSource?: boolean;
  /** Persist and restore volume. Defaults to false. */
  persistVolume?: boolean;
  /** Persist and restore muted state. Defaults to false. */
  persistMuted?: boolean;
  /** Persist and restore playback speed. Defaults to false. */
  persistPlaybackRate?: boolean;
  /** Persist and restore the last manual/auto quality selection. Defaults to false. */
  persistQuality?: boolean;
  /** Persist low-latency preference events. Defaults to false. */
  persistLowLatency?: boolean;
  /** Optional video element used to restore media-element preferences. */
  video?: HTMLVideoElement | string;
}

interface StoredPlaybackPreferences {
  volume?: number;
  muted?: boolean;
  playbackRate?: number;
  quality?: number | string | 'auto';
  lowLatency?: boolean;
  sourceIndex?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parsePreferences(raw: string | null): StoredPlaybackPreferences {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed as StoredPlaybackPreferences : {};
  } catch {
    return {};
  }
}

function clampUnit(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.max(0, Math.min(1, num));
}

function resolveVideo(video?: HTMLVideoElement | string): HTMLVideoElement | null {
  if (!video) return null;
  if (typeof document === 'undefined') return typeof video === 'string' ? null : video;
  if (typeof video === 'string') return document.querySelector(video) as HTMLVideoElement | null;
  return video;
}

function getSourceIndex(sources: Source[], current: Source | undefined): number {
  return current ? sources.indexOf(current) : -1;
}

function safeGetItem(storage: { getItem(key: string): string | null }, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function createStoragePlugin(options: StoragePluginOptions = {}): PluginCtor {
  return ({ player, storage }) => {
    if (!storage) return;
    const key = options.key ?? DEFAULT_KEY;
    const preferencesKey = options.preferencesKey ?? DEFAULT_PREFS_KEY;
    const restoreSource = options.restoreSource !== false;
    const persistSource = options.persistSource !== false;
    let preferences: StoredPlaybackPreferences = {};
    try {
      preferences = parsePreferences(safeGetItem(storage, preferencesKey));
    } catch {
      preferences = {};
    }
    const video = resolveVideo(options.video);

    if (options.persistVolume && preferences.volume !== undefined && video) {
      video.volume = Math.max(0, Math.min(1, preferences.volume));
    }
    if (options.persistMuted && preferences.muted !== undefined && video) {
      video.muted = preferences.muted;
    }
    if (options.persistPlaybackRate && preferences.playbackRate !== undefined && video) {
      video.playbackRate = Math.max(0.25, Math.min(4, preferences.playbackRate));
    }
    if (options.persistLowLatency && preferences.lowLatency !== undefined) {
      player.getSources().forEach((source) => {
        if (source.type === 'hls') {
          source.lowLatency = preferences.lowLatency;
        }
      });
    }

    if (restoreSource && persistSource) {
      try {
        const saved = safeGetItem(storage, key) ?? (
          preferences.sourceIndex !== undefined ? String(preferences.sourceIndex) : null
        );
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

    const savePreferences = (patch: Partial<StoredPlaybackPreferences>) => {
      const current = parsePreferences(safeGetItem(storage, preferencesKey));
      preferences = { ...current, ...patch };
      try {
        storage.setItem(preferencesKey, JSON.stringify(preferences));
      } catch {
        /* ignore */
      }
    };

    const sourceHandler = () => {
      if (!persistSource) return;
      const current = player.getCurrentSource();
      if (!current) return;
      const sources = player.getSources();
      const index = getSourceIndex(sources, current);
      if (index >= 0) {
        try {
          storage.setItem(key, String(index));
          savePreferences({ sourceIndex: index });
        } catch {
          /* ignore */
        }
      }
    };

    const preferenceHandler = (event: PlayerPreferenceEvent) => {
      const patch: Partial<StoredPlaybackPreferences> = {};
      if (event.key === 'volume' && options.persistVolume) {
        const volume = clampUnit(event.value);
        if (volume !== undefined) patch.volume = volume;
      }
      if (event.key === 'muted' && options.persistMuted) {
        patch.muted = Boolean(event.value);
      }
      if (event.key === 'playbackRate' && options.persistPlaybackRate) {
        const rate = Number(event.value);
        if (Number.isFinite(rate)) patch.playbackRate = Math.max(0.25, Math.min(4, rate));
      }
      if (event.key === 'quality' && options.persistQuality) {
        if (typeof event.value === 'string' || typeof event.value === 'number') {
          patch.quality = event.value as StoredPlaybackPreferences['quality'];
        }
      }
      if (event.key === 'lowLatency' && options.persistLowLatency) {
        patch.lowLatency = Boolean(event.value);
        player.getSources().forEach((source) => {
          if (source.type === 'hls') {
            source.lowLatency = patch.lowLatency;
          }
        });
      }
      if (event.key === 'sourceIndex' && persistSource) {
        const index = Number(event.value);
        if (Number.isInteger(index) && index >= 0 && index < player.getSources().length) {
          patch.sourceIndex = index;
          try {
            storage.setItem(key, String(index));
          } catch {
            /* ignore */
          }
        }
      }
      if (Object.keys(patch).length > 0) {
        savePreferences(patch);
      }
    };

    player.on('play', sourceHandler);
    player.on('preference', preferenceHandler);

    const readyHandler = () => {
      if (!options.persistQuality || preferences.quality === undefined) return;
      player.setQualityLevel(preferences.quality).catch(() => {
        /* ignore; active Tech may not support quality yet */
      });
    };
    player.on('ready', readyHandler);

    return {
      destroy: () => {
        player.off('play', sourceHandler);
        player.off('preference', preferenceHandler);
        player.off('ready', readyHandler);
      },
    };
  };
}
