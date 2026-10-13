import type { MpegtsLoader } from '../../types.js';

type MpegtsPlayerLike = {
  attachMediaElement(video: HTMLVideoElement): void;
  load(): void;
  play(): void | Promise<void>;
  pause(): void;
  unload(): void;
  detachMediaElement(): void;
  destroy(): void;
  on(event: string, handler: (err?: unknown) => void): void;
};

type MpegtsModuleLike = {
  isSupported(): boolean;
  createPlayer(
    mediaDataSource: { type: 'flv' | 'mpegts'; isLive: boolean; url: string },
    config?: Record<string, unknown>
  ): MpegtsPlayerLike;
  Events: {
    ERROR: string;
    LOADING_COMPLETE: string;
  };
  default?: MpegtsModuleLike;
};

/**
 * MSE fallback using mpegts.js for FLV/TS playback.
 * mpegts.js is loaded only when this path is explicitly used.
 */
export class MseFallback {
  private player: MpegtsPlayerLike | null = null;
  private generation = 0;

  async start(
    url: string,
    video: HTMLVideoElement,
    handlers?: { onReady?: () => void; onError?: (err: unknown) => void },
    format: 'flv' | 'mpegts' = 'flv',
    loader?: MpegtsLoader
  ): Promise<void> {
    this.stop();
    const generation = this.generation;
    const mpegts = await loadMpegts(loader);
    if (generation !== this.generation) return;
    if (!mpegts.isSupported()) {
      throw new Error('FLV/TS MSE not supported in this browser');
    }
    const player = mpegts.createPlayer(
      {
        type: format,
        isLive: true,
        url
      },
      {
        // Disable the internal worker to avoid cross-origin worker path issues.
        enableWorker: false,
        stashInitialSize: 128,
        deferLoadAfterSourceOpen: false,
        lazyLoad: false
      }
    );
    this.player = player;
    const isCurrent = () => generation === this.generation && this.player === player;
    const onError = (err: unknown) => { if (isCurrent()) handlers?.onError?.(err); };
    player.attachMediaElement(video);
    player.on(mpegts.Events.ERROR, onError);
    player.on(mpegts.Events.LOADING_COMPLETE, () => { if (isCurrent()) handlers?.onReady?.(); });
    player.load();
    // A live stream can wait indefinitely for its first frame. Do not make
    // Tech.load (and therefore source switching/teardown) wait for play().
    const playback = player.play();
    if (playback) void playback.catch(onError);
  }

  stop(): void {
    ++this.generation;
    const player = this.player;
    this.player = null;
    if (player) {
      for (const cleanup of ['pause', 'unload', 'detachMediaElement', 'destroy'] as const) {
        try { player[cleanup](); } catch { /* Continue releasing remaining resources. */ }
      }
    }
  }
}

function normalizeMpegtsModule(moduleLike: unknown): MpegtsModuleLike {
  const candidate = moduleLike as MpegtsModuleLike;
  const normalized = candidate?.default?.createPlayer ? candidate.default : candidate;
  if (!normalized?.isSupported || !normalized?.createPlayer || !normalized?.Events) {
    throw new Error('mpegts.js is not available. Provide PlayerOptions.mpegtsLoader, install mpegts.js, or load window.mpegts before TS/FLV playback.');
  }
  return normalized;
}

async function loadMpegts(loader?: MpegtsLoader): Promise<MpegtsModuleLike> {
  if (loader) {
    return normalizeMpegtsModule(await loader());
  }
  const globalMpegts = (globalThis as typeof globalThis & { mpegts?: unknown }).mpegts;
  if (globalMpegts) {
    return normalizeMpegtsModule(globalMpegts);
  }
  throw new Error('mpegts.js is not available. Provide PlayerOptions.mpegtsLoader, install mpegts.js, or load window.mpegts before TS/FLV playback.');
}
