import flvjs from 'flv.js';

/**
 * MSE fallback using flv.js to ensure WS播放可用，直到自研管线完成。
 */
export class MseFallback {
  private player: any | null = null;
  private onReady?: () => void;
  private onError?: (err: any) => void;

  start(url: string, video: HTMLVideoElement, handlers?: { onReady?: () => void; onError?: (err: any) => void }): void {
    this.onReady = handlers?.onReady;
    this.onError = handlers?.onError;
    if (!flvjs.isSupported()) {
      this.onError?.(new Error('FLV/WS not supported in this browser'));
      return;
    }
    this.stop();
    this.player = (flvjs as any).createPlayer(
      {
        type: 'flv',
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
    this.player.on(flvjs.Events.ERROR, (err: any) => this.onError?.(err));
    this.player.on(flvjs.Events.LOADING_COMPLETE, () => this.onReady?.());
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
