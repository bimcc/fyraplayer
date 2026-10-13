import type { PlaybackSessionChange, PluginCtor, Source } from '../types.js';

export interface FrameClockSample {
  /** HTML media timeline seconds; not an MPEG-TS PTS or wall-clock timestamp. */
  mediaTime: number;
  /** New epoch after source replacement, seek, or media reload. */
  epoch: number;
  precision: 'video-frame' | 'media-event';
  observedAt: number;
  expectedDisplayTime?: number;
  presentedFrames?: number;
  width: number;
  height: number;
  /** Reported playback source; legacy hosts expose only the requested source. */
  source?: Source;
  sessionEpoch?: number;
}

export type FrameClockResetReason = 'sourcechange' | 'sessionchange' | 'seeking' | 'loadstart' | 'emptied';
export interface FrameClockHandle {
  getLatest(): FrameClockSample | null;
  destroy(): void;
}
export interface FrameClockPluginOptions {
  onHandle?: (handle: FrameClockHandle) => void;
  onFrame?: (sample: FrameClockSample) => void;
  onReset?: (reason: FrameClockResetReason, epoch: number) => void;
  onError?: (error: unknown) => void;
  /** Older browsers: report media events with reduced precision, or report no samples. */
  fallback?: 'media-events' | 'none';
}

export interface MediaPtsAnchor {
  mediaTime: number;
  pts90k: bigint;
}

/** Unit/origin mapping only. The caller owns discontinuities and 33-bit PTS unwrapping. */
export function mediaTimeToPts90k(mediaTime: number, anchor: MediaPtsAnchor): bigint {
  const ticks = Math.round((mediaTime - anchor.mediaTime) * 90000);
  if (!Number.isFinite(mediaTime) || !Number.isFinite(anchor.mediaTime) || !Number.isSafeInteger(ticks)) {
    throw new RangeError('Media time delta must be finite and safely representable in 90 kHz ticks');
  }
  return anchor.pts90k + BigInt(ticks);
}

/** Observes the video presentation clock without a polling interval or changing playback. */
export function createFrameClockPlugin(options: FrameClockPluginOptions = {}): PluginCtor {
  return ({ player, lifecycle }) => {
    const video = player.getVideoElement();
    const hasFrames = typeof video.requestVideoFrameCallback === 'function'
      && typeof video.cancelVideoFrameCallback === 'function';
    let active = true;
    let waiting = false;
    let epoch = 0;
    let latest: FrameClockSample | null = null;
    let callbackId: number | null = null;
    const hasSession = typeof player.getPlaybackSession === 'function';
    let sessionEpoch = player.getPlaybackSession?.()?.epoch;
    const sourceInfo = () => {
      const session = player.getPlaybackSession?.();
      return { source: hasSession ? session?.source : player.getCurrentSource(), sessionEpoch: session?.epoch };
    };
    const listeners: Array<[string, EventListener]> = [];
    const notify = (callback: (() => void) | undefined) => {
      try { callback?.(); } catch (error) {
        try { options.onError?.(error); } catch { /* Consumer reporting cannot break the clock. */ }
      }
    };
    const cancel = () => {
      if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
      callbackId = null;
    };
    const publish = (sample: FrameClockSample) => {
      if (!active || waiting || video.seeking || (hasSession && !player.getPlaybackSession?.()) || !Number.isFinite(sample.mediaTime)) return;
      latest = sample;
      notify(() => options.onFrame?.({ ...sample }));
    };
    const schedule = () => {
      if (!active || waiting || !hasFrames || callbackId !== null) return;
      const generation = epoch;
      callbackId = video.requestVideoFrameCallback((now, metadata) => {
        if (!active || generation !== epoch) return;
        callbackId = null;
        try {
          publish({
            mediaTime: metadata.mediaTime, epoch, precision: 'video-frame',
            observedAt: now, expectedDisplayTime: metadata.expectedDisplayTime,
            presentedFrames: metadata.presentedFrames,
            width: metadata.width, height: metadata.height,
            ...sourceInfo()
          });
        } finally { schedule(); }
      });
    };
    const reset = (reason: FrameClockResetReason) => {
      if (!active) return;
      ++epoch;
      latest = null;
      waiting = true;
      cancel();
      notify(() => options.onReset?.(reason, epoch));
    };
    const resume = () => {
      if (!active || (hasSession && !player.getPlaybackSession?.())) return;
      waiting = false;
      schedule();
    };
    const add = (event: string, handler: () => void) => {
      video.addEventListener(event, handler);
      listeners.push([event, handler]);
    };
    const onSourceChange = () => reset('sourcechange');
    const onSessionChange = (event: PlaybackSessionChange) => {
      if (event.epoch !== sessionEpoch) {
        sessionEpoch = event.epoch;
        reset('sessionchange');
      }
      if (event.session) resume();
    };
    const handle: FrameClockHandle = {
      getLatest: () => active && latest ? { ...latest } : null,
      destroy: () => {
        if (!active) return;
        active = false;
        ++epoch;
        latest = null;
        cancel();
        listeners.forEach(([event, handler]) => video.removeEventListener(event, handler));
        player.off('sourcechange', onSourceChange);
        player.off('sessionchange', onSessionChange);
        player.off('ready', resume);
        lifecycle?.signal.removeEventListener('abort', handle.destroy);
      }
    };
    lifecycle?.onCleanup(handle.destroy);
    lifecycle?.signal.addEventListener('abort', handle.destroy, { once: true });
    if (lifecycle?.signal.aborted) handle.destroy();
    try {
      if (active) {
        for (const event of ['seeking', 'loadstart', 'emptied'] as const) add(event, () => reset(event));
        for (const event of ['seeked', 'loadeddata', 'playing']) add(event, resume);
        if (!hasFrames && options.fallback !== 'none') {
          const sample = () => {
            if (video.readyState < 2) return;
            publish({ mediaTime: video.currentTime, epoch, precision: 'media-event',
              observedAt: performance.now(), width: video.videoWidth, height: video.videoHeight,
              ...sourceInfo() });
          };
          for (const event of ['timeupdate', 'loadeddata', 'seeked']) add(event, sample);
        }
        if (hasSession) player.on('sessionchange', onSessionChange);
        else player.on('sourcechange', onSourceChange);
        player.on('ready', resume);
        schedule();
      }
      options.onHandle?.(handle);
    } catch (error) { handle.destroy(); throw error; }
    return handle;
  };
}
