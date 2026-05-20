import type { MpegtsLoader } from '../../types.js';

type MpegtsPlayerLike = {
  attachMediaElement(video: HTMLVideoElement): void;
  load(): void;
  play(): void;
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
  private onReady?: () => void;
  private onError?: (err: unknown) => void;

  async start(
    url: string,
    video: HTMLVideoElement,
    handlers?: { onReady?: () => void; onError?: (err: unknown) => void },
    format: 'flv' | 'mpegts' = 'flv',
    loader?: MpegtsLoader
  ): Promise<void> {
    this.onReady = handlers?.onReady;
    this.onError = handlers?.onError;
    const mpegts = await loadMpegts(loader);
    if (!mpegts.isSupported()) {
      this.onError?.(new Error('FLV/TS MSE not supported in this browser'));
      return;
    }
    this.stop();
    this.player = mpegts.createPlayer(
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
    this.player.attachMediaElement(video);
    this.player.load();
    this.player.play();
    this.player.on(mpegts.Events.ERROR, (err: unknown) => this.onError?.(err));
    this.player.on(mpegts.Events.LOADING_COMPLETE, () => this.onReady?.());
  }

  stop(): void {
    if (this.player) {
      try {
        this.player.pause();
        this.player.unload();
        this.player.detachMediaElement();
        this.player.destroy();
      } catch {
        /* ignore */
      }
      this.player = null;
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
