/**
 * FyraPlayer Fullscreen Handler
 * Manages fullscreen styles and transitions
 */
import type { OriginalStyles, FullscreenHandler } from './types.js';

/**
 * Creates fullscreen style handler for video element
 */
export function createFullscreenHandler(
  video: HTMLVideoElement | null,
  host: HTMLElement | null,
  uiShell: HTMLElement,
  onFullscreenChange?: () => void
): FullscreenHandler {
  const originalStyles: OriginalStyles = {
    video: {},
    host: {},
    shell: {},
  };

  let boundHandler: (() => void) | null = null;

  const saveOriginalStyles = () => {
    if (video) {
      originalStyles.video = {
        position: video.style.position,
        top: video.style.top,
        left: video.style.left,
        width: video.style.width,
        height: video.style.height,
        maxWidth: video.style.maxWidth,
        maxHeight: video.style.maxHeight,
        minHeight: video.style.minHeight,
        aspectRatio: video.style.aspectRatio,
        objectFit: video.style.objectFit,
      };
    }

    if (host) {
      originalStyles.host = {
        width: host.style.width,
        height: host.style.height,
        maxWidth: host.style.maxWidth,
      };
    }
  };

  const applyFullscreenStyles = () => {
    if (!video || !host) return;

    saveOriginalStyles();

    video.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
      min-height: 100vh !important;
      aspect-ratio: auto !important;
      object-fit: contain !important;
      z-index: 1 !important;
      background: #000 !important;
    `;

    host.style.cssText = `
      position: relative !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      background: #000 !important;
    `;

    uiShell.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
    `;
  };

  const restoreStyles = () => {
    if (!video || !host) return;

    video.style.position = originalStyles.video.position || '';
    video.style.top = originalStyles.video.top || '';
    video.style.left = originalStyles.video.left || '';
    video.style.width = originalStyles.video.width || '';
    video.style.height = originalStyles.video.height || '';
    video.style.maxWidth = originalStyles.video.maxWidth || '';
    video.style.maxHeight = originalStyles.video.maxHeight || '';
    video.style.minHeight = originalStyles.video.minHeight || '';
    video.style.aspectRatio = originalStyles.video.aspectRatio || '';
    video.style.objectFit = originalStyles.video.objectFit || '';
    video.style.zIndex = '';
    video.style.background = '';

    host.style.width = originalStyles.host.width || '';
    host.style.height = originalStyles.host.height || '';
    host.style.maxWidth = originalStyles.host.maxWidth || '';
    host.style.background = '';

    uiShell.style.position = 'absolute';
    uiShell.style.top = '';
    uiShell.style.left = '';
    uiShell.style.width = '';
    uiShell.style.height = '';
    uiShell.style.zIndex = '';
    uiShell.style.inset = '0';
  };

  const handleFullscreenChange = () => {
    if (document.fullscreenElement) {
      applyFullscreenStyles();
    } else {
      restoreStyles();
    }
    onFullscreenChange?.();
  };

  return {
    attach: () => {
      boundHandler = handleFullscreenChange;
      document.addEventListener('fullscreenchange', boundHandler);
      document.addEventListener('webkitfullscreenchange', boundHandler);
      document.addEventListener('mozfullscreenchange', boundHandler);
    },
    detach: () => {
      if (boundHandler) {
        document.removeEventListener('fullscreenchange', boundHandler);
        document.removeEventListener('webkitfullscreenchange', boundHandler);
        document.removeEventListener('mozfullscreenchange', boundHandler);
        boundHandler = null;
      }
    },
  };
}

/**
 * Injects global fullscreen CSS styles
 */
export function injectFullscreenStyles(): void {
  const styleId = 'fyra-fullscreen-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Fullscreen container reset */
    *:fullscreen,
    *:-webkit-full-screen,
    *:-moz-full-screen {
      background: #000 !important;
    }
    /* Video in fullscreen - MUST override aspect-ratio */
    *:fullscreen video,
    *:-webkit-full-screen video,
    *:-moz-full-screen video,
    video:fullscreen,
    video:-webkit-full-screen,
    video:-moz-full-screen {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
      min-width: 100vw !important;
      min-height: 100vh !important;
      aspect-ratio: auto !important;
      object-fit: contain !important;
      transform: none !important;
      margin: 0 !important;
      padding: 0 !important;
      z-index: 1 !important;
    }
    /* Canvas in fullscreen */
    *:fullscreen canvas,
    *:-webkit-full-screen canvas,
    *:-moz-full-screen canvas {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: 100vw !important;
      max-height: 100vh !important;
      object-fit: contain !important;
      transform: none !important;
      margin: 0 !important;
      padding: 0 !important;
      z-index: 1 !important;
    }
    /* UI shell overlay in fullscreen */
    *:fullscreen fyra-ui-shell,
    *:-webkit-full-screen fyra-ui-shell,
    *:-moz-full-screen fyra-ui-shell {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
    }
  `;
  document.head.appendChild(style);
}
