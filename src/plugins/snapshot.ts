import type { PlaybackSessionChange, PluginCtor } from '../types.js';

export interface SnapshotOptions {
  type?: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  signal?: AbortSignal;
}
export interface SnapshotResult {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
  ts: number;
  /** Media position when pixels were copied, not when encoding finished. */
  mediaTime: number;
}
export interface SnapshotHandle {
  capture(options?: Omit<SnapshotOptions, 'signal'>): Promise<SnapshotResult>;
  destroy(): void;
}
export interface SnapshotPluginOptions extends Omit<SnapshotOptions, 'signal'> {
  onHandle: (handle: SnapshotHandle) => void;
}

function aborted(): Error { return new DOMException('Snapshot cancelled', 'AbortError'); }

/** Copies decoded video pixels into a Blob. No automatic download, DOM mount, or upload. */
export async function captureSnapshot(video: HTMLVideoElement, options: SnapshotOptions = {}): Promise<SnapshotResult> {
  if (options.signal?.aborted) throw aborted();
  if (video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    throw new Error('No decoded video frame is available');
  }
  for (const limit of [options.maxWidth, options.maxHeight]) {
    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1)) throw new RangeError('Snapshot dimensions must be finite and at least 1');
  }
  if (options.quality !== undefined && (!Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)) {
    throw new RangeError('Snapshot quality must be between 0 and 1');
  }
  const scale = Math.min(1, (options.maxWidth ?? video.videoWidth) / video.videoWidth,
    (options.maxHeight ?? video.videoHeight) / video.videoHeight);
  const width = Math.max(1, Math.floor(video.videoWidth * scale));
  const height = Math.max(1, Math.floor(video.videoHeight * scale));
  const canvas = video.ownerDocument.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ts = Date.now();
  const mediaTime = video.currentTime;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      const signal = options.signal;
      let settled = false;
      const finish = (value?: Blob | null, error?: unknown) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else if (value) resolve(value);
        else reject(new Error('Snapshot encoding produced no image'));
      };
      const onAbort = () => finish(null, aborted());
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) { onAbort(); return; }
      try { canvas.toBlob(value => finish(value), options.type ?? 'image/png', options.quality); }
      catch (error) { finish(null, error); } // Includes tainted-canvas SecurityError.
    });
    if (options.signal?.aborted) throw aborted();
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    return { blob, width, height, filename: `snapshot-${ts}.${extension}`, ts, mediaTime };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function createSnapshotPlugin(options: SnapshotPluginOptions): PluginCtor {
  return ({ player, lifecycle }) => {
    const video = player.getVideoElement();
    let active = true;
    let controller = new AbortController();
    let sessionEpoch = player.getPlaybackSession?.()?.epoch;
    const invalidate = () => {
      controller.abort();
      controller = new AbortController();
    };
    const onSessionChange = (event: PlaybackSessionChange) => {
      if (event.epoch === sessionEpoch) return;
      sessionEpoch = event.epoch;
      invalidate();
    };
    const handle: SnapshotHandle = {
      capture: overrides => {
        if (!active) return Promise.reject(aborted());
        if (player.getPlaybackSession && !player.getPlaybackSession()) return Promise.reject(new Error('No active playback session'));
        return captureSnapshot(video, { ...options, ...overrides, signal: controller.signal });
      },
      destroy: () => {
        if (!active) return;
        active = false;
        controller.abort();
        player.off('sourcechange', invalidate);
        player.off('sessionchange', onSessionChange);
        video.removeEventListener('loadstart', invalidate);
        lifecycle?.signal.removeEventListener('abort', handle.destroy);
      }
    };
    lifecycle?.onCleanup(handle.destroy);
    lifecycle?.signal.addEventListener('abort', handle.destroy, { once: true });
    if (lifecycle?.signal.aborted) handle.destroy();
    try {
      if (active) {
        player.on('sourcechange', invalidate);
        player.on('sessionchange', onSessionChange);
        video.addEventListener('loadstart', invalidate);
      }
      options.onHandle(handle);
    } catch (error) { handle.destroy(); throw error; }
    return handle;
  };
}
