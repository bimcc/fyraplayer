import mpegts from 'mpegts.js';

/**
 * MSE fallback using mpegts.js to ensure WS播放可用，直到自研管线完成。
 * mpegts.js 同时支持 FLV 和 TS 格式。
 */
export class MseFallback {
  private player: mpegts.Player | null = null;
  private onReady?: () => void;
  private onError?: (err: unknown) => void;

  start(
    url: string,
    video: HTMLVideoElement,
    handlers?: { onReady?: () => void; onError?: (err: unknown) => void },
    format: 'flv' | 'mpegts' = 'flv'
  ): void {
    this.onReady = handlers?.onReady;
    this.onError = handlers?.onError;
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
        // 禁用内部 worker 以避免跨域/路径问题
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
