import { FyraPlayer } from '../../player.js';
import { PlayerOptions, Source, TechName } from '../../types.js';

export interface FyraPsvAdapterOptions {
  /** Fyra sources, e.g., webrtc/ws-raw/hlsdash/gb28181 */
  sources: Source[];
  /** Tech preference override */
  techOrder?: TechName[];
  /** Video element that PSV will use as texture */
  video: HTMLVideoElement;
  /** Use VideoFrame hook + CanvasFrameBuffer captureStream for lower-latency texture (ws-raw + WebCodecs) */
  useFrameHook?: boolean;
  /** Additional player options to merge (autoplay, muted, middleware, etc.) */
  playerOptions?: Omit<PlayerOptions, 'video' | 'sources' | 'techOrder'>;
  /** Custom factory for FyraPlayer if you need to subclass/wrap */
  playerFactory?: (opts: PlayerOptions) => FyraPlayer;
  /** Callback after player is ready */
  onReady?: (player: FyraPlayer) => void;
}

/**
 * Thin adapter to run FyraPlayer for Photo Sphere Viewer.
 * This does not register itself; you still need to wrap it into a PSV plugin
 * (e.g., via PhotoSphereViewer.registerPlugin) on the consumer side.
 */
export class FyraPsvAdapter {
  private player: FyraPlayer | null = null;
  private frameRenderer: any = null;

  constructor(private readonly opts: FyraPsvAdapterOptions) {}

  async init(): Promise<FyraPlayer> {
    if (this.player) return this.player;
    const { sources, techOrder, video, playerOptions, playerFactory, onReady } = this.opts;
    const factory = playerFactory ?? ((o: PlayerOptions) => new FyraPlayer(o));
    const useHook = !!this.opts.useFrameHook;
    let captureStream: MediaStream | null = null;

    // Optional: create a canvas frame buffer to draw VideoFrame and capture as stream
    let frameHook: ((frame: VideoFrame) => void) | undefined;
    if (useHook) {
      const { CanvasFrameBuffer } = await import('../../render/canvasFrameBuffer.js');
      this.frameRenderer = new CanvasFrameBuffer();
      frameHook = (frame: VideoFrame) => this.frameRenderer?.renderFrame(frame);
      captureStream = this.frameRenderer?.getCaptureStream(30) ?? null;
      if (captureStream) {
        try {
          (video as any).srcObject = captureStream;
        } catch {
          /* ignore */
        }
      }
    }

    const player = factory({
      video,
      sources,
      techOrder,
      ...(playerOptions ?? {})
    });
    // Attach frame hook if available after init
    await player.init();
    if (frameHook) {
      this.attachFrameHook(player, frameHook);
    }
    this.player = player;
    onReady?.(player);
    return player;
  }

  getPlayer(): FyraPlayer | null {
    return this.player;
  }

  async destroy(): Promise<void> {
    if (!this.player) return;
    await this.player.destroy();
    this.player = null;
    if (this.frameRenderer?.destroy) {
      this.frameRenderer.destroy();
      this.frameRenderer = null;
    }
  }

  private attachFrameHook(player: FyraPlayer, hook: (frame: VideoFrame) => void): void {
    const techManager = (player as any)?.techManager;
    const tech = techManager?.getCurrentTech?.();
    if (tech && typeof tech.setFrameHook === 'function') {
      tech.setFrameHook(hook);
    }
  }
}
