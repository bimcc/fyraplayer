/**
 * FyraPlayer UI Controls utilities
 * Extracted from ui-components.ts for better maintainability
 */

import { captureSnapshot } from '../plugins/snapshot.js';
import { getFullscreenElement, toggleContainerFullscreen } from '../utils/fullscreen.js';

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const h = Math.floor(sec / 3600);
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

export function getDuration(video: HTMLVideoElement | null): number {
  if (!video) return NaN;
  if (isFinite(video.duration) && video.duration > 0) return video.duration;
  const seekable = video.seekable;
  if (seekable && seekable.length > 0) {
    return seekable.end(seekable.length - 1);
  }
  return NaN;
}

export interface CaptureFrameResult {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
  ts: number;
}

export async function captureFrame(video: HTMLVideoElement | null): Promise<CaptureFrameResult | null> {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const result = await captureSnapshot(video);
  const url = URL.createObjectURL(result.blob);
  try {
    const link = video.ownerDocument.createElement('a');
    link.href = url;
    link.download = result.filename;
    link.click();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return result;
}

export async function toggleFullscreen(target: HTMLElement | null): Promise<void> {
  await toggleContainerFullscreen(target || document.body);
}

export function isFullscreen(target?: HTMLElement | null): boolean {
  const current = getFullscreenElement();
  return target ? current === target : !!current;
}

type DocumentWithPip = Document & {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
};

type VideoWithPip = HTMLVideoElement & {
  requestPictureInPicture?: () => Promise<unknown>;
};

export async function togglePip(video: HTMLVideoElement | null): Promise<void> {
  const pipDocument = document as DocumentWithPip;
  const pipVideo = video as VideoWithPip | null;
  if (!pipVideo || !pipDocument.pictureInPictureEnabled) return;
  if (pipDocument.pictureInPictureElement) {
    await pipDocument.exitPictureInPicture?.();
  } else {
    await pipVideo.requestPictureInPicture?.();
  }
}

export function toggleMute(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  video.muted = !video.muted;
  return video.muted;
}

/**
 * Keyboard shortcut handler configuration
 */
export interface KeyboardConfig {
  /** Bind shortcuts to one player container. Omit only for legacy global consumers. */
  target?: HTMLElement;
  onTogglePlay?: () => void;
  onFullscreen?: () => void;
  onPip?: () => void;
  onToggleLog?: () => void;
  onSeekForward?: () => void;
  onSeekBackward?: () => void;
  onVolumeUp?: () => void;
  onVolumeDown?: () => void;
  onMute?: () => void;
}

/**
 * Creates a keyboard event handler with cleanup support
 */
export function createKeyboardHandler(config: KeyboardConfig): {
  handler: (e: KeyboardEvent) => void;
  attach: () => void;
  detach: () => void;
} {
  const handler = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const path = e.composedPath();
    if (path.some(node => node instanceof HTMLElement && (node.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(node.tagName)))) return;
    
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        config.onTogglePlay?.();
        break;
      case 'KeyF':
        config.onFullscreen?.();
        break;
      case 'KeyP':
        config.onPip?.();
        break;
      case 'KeyL':
      case 'F8':
        config.onToggleLog?.();
        break;
      case 'ArrowRight':
        e.preventDefault();
        config.onSeekForward?.();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        config.onSeekBackward?.();
        break;
      case 'ArrowUp':
        e.preventDefault();
        config.onVolumeUp?.();
        break;
      case 'ArrowDown':
        e.preventDefault();
        config.onVolumeDown?.();
        break;
      case 'KeyM':
        config.onMute?.();
        break;
    }
  };

  return {
    handler,
    attach: () => (config.target ?? window).addEventListener('keydown', handler as EventListener),
    detach: () => (config.target ?? window).removeEventListener('keydown', handler as EventListener),
  };
}

/**
 * Double-click handler with single-click fallback
 * Prevents single click from firing on double click
 */
export function createClickHandler(config: {
  onSingleClick?: () => void;
  onDoubleClick?: () => void;
  delay?: number;
}): {
  handler: (e: MouseEvent) => void;
  cleanup: () => void;
} {
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let clickCount = 0;
  const delay = config.delay ?? 250;

  const handler = () => {
    clickCount++;
    
    if (clickCount === 1) {
      clickTimer = setTimeout(() => {
        if (clickCount === 1) {
          config.onSingleClick?.();
        }
        clickCount = 0;
      }, delay);
    } else if (clickCount === 2) {
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      config.onDoubleClick?.();
      clickCount = 0;
    }
  };

  const cleanup = () => {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    clickCount = 0;
  };

  return { handler, cleanup };
}
