/**
 * FyraPlayer UI Controls utilities
 * Extracted from ui-components.ts for better maintainability
 */

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

export function captureFrame(video: HTMLVideoElement | null): void {
  if (!video) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `snapshot-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

export async function toggleFullscreen(target: HTMLElement | null): Promise<void> {
  const el = target || document.body;
  if (!document.fullscreenElement) {
    await el.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
}

export function isFullscreen(): boolean {
  return !!document.fullscreenElement;
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
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    
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
    attach: () => window.addEventListener('keydown', handler),
    detach: () => window.removeEventListener('keydown', handler),
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
