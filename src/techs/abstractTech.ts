import { BufferPolicy, EngineStats, MetricsOptions, ReconnectPolicy, Source, Tech } from '../types.js';
import { EventBus } from '../core/eventBus.js';

export abstract class AbstractTech implements Tech {
  protected bus = new EventBus();
  protected source: Source | null = null;
  protected buffer?: BufferPolicy;
  protected reconnect?: ReconnectPolicy;
  protected metrics?: MetricsOptions;
  protected video: HTMLVideoElement | null = null;
  private lastStatsFrameTs = 0;
  private lastTotalVideoFrames: number | undefined;

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

  on(event: string, handler: (...args: unknown[]) => void): void {
    this.bus.on(event, handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.bus.off(event, handler);
  }

  removeAllListeners(event?: string): void {
    this.bus.removeAllListeners(event);
  }

  getStats(): EngineStats {
    if (this.video) {
      const videoWithPlaybackQuality = this.video as HTMLVideoElement & {
        getVideoPlaybackQuality?: () => { droppedVideoFrames?: number; totalVideoFrames?: number };
      };
      const quality = videoWithPlaybackQuality.getVideoPlaybackQuality?.();
      const now = Date.now();
      return {
        ts: now,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        droppedFrames: quality?.droppedVideoFrames,
        fps: this.calculatePlaybackFps(quality?.totalVideoFrames, now)
      };
    }
    return { ts: Date.now() };
  }

  protected calculatePlaybackFps(totalVideoFrames: number | undefined, now = Date.now()): number | undefined {
    if (typeof totalVideoFrames !== 'number' || !Number.isFinite(totalVideoFrames)) {
      return undefined;
    }
    if (
      typeof this.lastTotalVideoFrames !== 'number' ||
      this.lastStatsFrameTs <= 0 ||
      totalVideoFrames < this.lastTotalVideoFrames
    ) {
      this.lastTotalVideoFrames = totalVideoFrames;
      this.lastStatsFrameTs = now;
      return undefined;
    }
    const elapsedMs = Math.max(1, now - this.lastStatsFrameTs);
    const frameDelta = Math.max(0, totalVideoFrames - this.lastTotalVideoFrames);
    this.lastTotalVideoFrames = totalVideoFrames;
    this.lastStatsFrameTs = now;
    return frameDelta / (elapsedMs / 1000);
  }

  protected resetPlaybackFpsSampler(): void {
    this.lastStatsFrameTs = 0;
    this.lastTotalVideoFrames = undefined;
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
    this.resetPlaybackFpsSampler();
    this.bus.removeAllListeners();
  }
}
