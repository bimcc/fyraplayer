import { FyraPlayer } from '../../player.js';
import { MetadataEvent, PlayerOptions, Source, TechName } from '../../types.js';

export interface FyraCesiumAdapterOptions {
  sources: Source[];
  techOrder?: TechName[];
  /** Video element used as Cesium texture source */
  video: HTMLVideoElement;
  /** Optional: additional PlayerOptions (autoplay, muted, middleware, etc.) */
  playerOptions?: Omit<PlayerOptions, 'video' | 'sources' | 'techOrder'>;
  /** Optional factory if you wrap/subclass FyraPlayer */
  playerFactory?: (opts: PlayerOptions) => FyraPlayer;
  /** Metadata hook (e.g., forward to KlvBridge / beeviz/klv) */
  onMetadata?: (event: MetadataEvent) => void;
  /** Ready hook */
  onReady?: (player: FyraPlayer) => void;
  /** Optional frame hook for VideoFrame (ws-raw + WebCodecs) to feed custom rendering */
  frameHook?: (frame: VideoFrame) => void;
}

/**
 * Thin adapter to feed FyraPlayer output into Cesium (via beeviz/cesium VideoSource).
 * Consumer is expected to instantiate VideoSource/UAVVisualizer and attach the video element.
 */
export class FyraCesiumAdapter {
  private player: FyraPlayer | null = null;
  private metadataHandler?: (evt: MetadataEvent) => void;

  constructor(private readonly opts: FyraCesiumAdapterOptions) {}

  async init(): Promise<FyraPlayer> {
    if (this.player) return this.player;
    const { sources, techOrder, video, playerOptions, playerFactory, onMetadata, onReady, frameHook } = this.opts;
    const factory = playerFactory ?? ((o: PlayerOptions) => new FyraPlayer(o));
    const player = factory({
      video,
      sources,
      techOrder,
      ...(playerOptions ?? {})
    });

    if (onMetadata) {
      this.metadataHandler = (evt: MetadataEvent) => onMetadata(evt);
      player.on('metadata', this.metadataHandler);
    }

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
    if (this.metadataHandler) {
      this.player.off?.('metadata', this.metadataHandler);
      this.metadataHandler = undefined;
    }
    await this.player.destroy();
    this.player = null;
  }

  private attachFrameHook(player: FyraPlayer, hook: (frame: VideoFrame) => void): void {
    const techManager = (player as any)?.techManager;
    const tech = techManager?.getCurrentTech?.();
    if (tech && typeof tech.setFrameHook === 'function') {
      tech.setFrameHook(hook);
    }
  }
}
