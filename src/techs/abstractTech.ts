import { BufferPolicy, EngineStats, MetricsOptions, ReconnectPolicy, Source, Tech } from '../types.js';
import { EventBus } from '../core/eventBus.js';

export abstract class AbstractTech implements Tech {
  protected bus = new EventBus();
  protected source: Source | null = null;
  protected buffer?: BufferPolicy;
  protected reconnect?: ReconnectPolicy;
  protected metrics?: MetricsOptions;
  protected video: HTMLVideoElement | null = null;

  abstract canPlay(source: Source): boolean;

  abstract load(
    source: Source,
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
      webCodecs?: import('../types.js').WebCodecsConfig;
      dataChannel?: import('../types.js').DataChannelOptions;
    }
  ): Promise<void>;

  on(event: string, handler: (...args: any[]) => void): void {
    this.bus.on(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this.bus.off(event, handler);
  }

  removeAllListeners(event?: string): void {
    this.bus.removeAllListeners(event);
  }

  getStats(): EngineStats {
    if (this.video) {
      const quality = (this.video as any).getVideoPlaybackQuality?.();
      return {
        ts: Date.now(),
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        droppedFrames: quality?.droppedVideoFrames,
        fps: quality ? quality.totalVideoFrames : undefined
      };
    }
    return { ts: Date.now() };
  }

  async play(): Promise<void> {
    if (this.video) {
      await this.video.play?.();
    }
    this.bus.emit('play');
  }

  async pause(): Promise<void> {
    if (this.video) {
      this.video.pause?.();
    }
    this.bus.emit('pause');
  }

  async seek(time: number): Promise<void> {
    if (this.video) {
      this.video.currentTime = time;
      return;
    }
    throw new Error('Seek not supported for this tech');
  }

  async destroy(): Promise<void> {
    // Clean up all event listeners to prevent memory leaks
    this.bus.removeAllListeners();
  }
}
