import type { MetadataDetectedEvent, MetadataEvent, PlaybackSession, PlaybackSessionChange, PluginCtor, Source } from '../../src/types.js';

/** Structural contract implemented by fyraklv's KLVStreamManager. No runtime dependency. */
export interface KlvService<State> {
  processLiveData(data: Uint8Array, pts: bigint): void;
  getInterpolatedStateAtPts(pts: bigint): State | null;
  reset(): void;
  destroy(): void;
}

export interface FyraKlvHandle<State> {
  /** Read against the current video clock, using the application's explicit timeline mapping. */
  getState(): State | null;
  getStateAtPts(pts90k: bigint): State | null;
}

export interface FyraKlvOptions<State> {
  /** A fresh, plugin-owned service per player. Example: () => new KLVStreamManager(). */
  createService: () => KlvService<State>;
  /** Return null until the application knows the current stream's timestamp origin. */
  mediaTimeToPts: (seconds: number, source: Source | undefined, session?: PlaybackSession) => bigint | null;
  /** Clear application-owned anchors whenever the player timeline epoch changes. */
  onTimelineReset?: (event: PlaybackSessionChange) => void;
  /** Override the media clock, e.g. frameClock.getLatest()?.mediaTime. Null means unavailable. */
  getMediaTime?: () => number | null;
  onHandle: (handle: FyraKlvHandle<State>) => void;
  onError?: (error: unknown) => void;
}

/** Application-layer integration example, not an SDK package export. */
export function createFyraKlvPlugin<State>(options: FyraKlvOptions<State>): PluginCtor {
  return ({ player, lifecycle }) => {
    const service = options.createService();
    let active = true;
    let disposed = false;
    const hasSession = typeof player.getPlaybackSession === 'function';
    let sessionEpoch = player.getPlaybackSession?.()?.epoch;
    const canQuery = () => active && (!hasSession || !!player.getPlaybackSession?.());
    const handle: FyraKlvHandle<State> = {
      getState: () => {
        if (!canQuery()) return null;
        const seconds = options.getMediaTime ? options.getMediaTime() : player.currentTime;
        if (seconds === null || !Number.isFinite(seconds)) return null;
        const session = player.getPlaybackSession?.() ?? undefined;
        const pts = options.mediaTimeToPts(seconds, hasSession ? session?.source : player.getCurrentSource(), session);
        return pts === null ? null : service.getInterpolatedStateAtPts(pts);
      },
      getStateAtPts: pts => canQuery() ? service.getInterpolatedStateAtPts(pts) : null
    };
    const onMetadata = (event: MetadataEvent | MetadataDetectedEvent) => {
      if (!canQuery() || event.type !== 'private-data') return;
      try {
        const pts = event.pts90k ?? (event.timestampUs === undefined ? BigInt(Math.round(event.pts * 90))
          : timestampToPts(event.timestampUs));
        service.processLiveData(event.raw, pts);
      } catch (error) {
        options.onError?.(error);
      }
    };
    const onSourceChange = () => service.reset();
    const onSessionChange = (event: PlaybackSessionChange) => {
      if (!active || event.epoch === sessionEpoch) return;
      sessionEpoch = event.epoch;
      service.reset();
      options.onTimelineReset?.(event);
    };
    const deactivate = () => { active = false; };
    lifecycle?.signal.addEventListener('abort', deactivate, { once: true });
    player.on('metadata', onMetadata);
    if (hasSession) player.on('sessionchange', onSessionChange);
    else player.on('sourcechange', onSourceChange);
    // Seeking retains buffered frames; getState() queries the new media time.
    try {
      options.onHandle(handle);
    } catch (error) {
      active = false;
      player.off('metadata', onMetadata);
      player.off('sourcechange', onSourceChange);
      player.off('sessionchange', onSessionChange);
      lifecycle?.signal.removeEventListener('abort', deactivate);
      service.destroy();
      throw error;
    }
    return {
      destroy() {
        if (disposed) return;
        disposed = true;
        active = false;
        player.off('metadata', onMetadata);
        player.off('sourcechange', onSourceChange);
        player.off('sessionchange', onSessionChange);
        lifecycle?.signal.removeEventListener('abort', deactivate);
        service.destroy();
      }
    };
  };
}

function timestampToPts(timestamp:number):bigint {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new RangeError('Invalid transport timestamp');
  return (BigInt(timestamp) * 9n + 50n) / 100n;
}
