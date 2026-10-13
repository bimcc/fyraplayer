/** Fullscreen observation scoped to this player; application inline styles stay intact. */
import type { FullscreenHandler } from './types.js';
import { FULLSCREEN_CHANGE_EVENT, releaseFullscreen, injectContainerFullscreenStyles } from '../utils/fullscreen.js';

export function createFullscreenHandler(
  _video: HTMLVideoElement | null,
  host: HTMLElement | null,
  _uiShell: HTMLElement,
  onFullscreenChange?: () => void
): FullscreenHandler {
  const events = ['fullscreenchange', 'webkitfullscreenchange', FULLSCREEN_CHANGE_EVENT];
  const handler = () => onFullscreenChange?.();
  return {
    attach: () => events.forEach(event => document.addEventListener(event, handler)),
    detach: () => {
      events.forEach(event => document.removeEventListener(event, handler));
      if (host) void releaseFullscreen(host).catch(() => {});
    },
  };
}

export const injectFullscreenStyles = injectContainerFullscreenStyles;
