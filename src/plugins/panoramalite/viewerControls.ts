import type { PanoramaLiteMediaType, PanoramaLiteViewerControlsOptions } from './types.js';
import { controlIconSvg, type ControlIcon } from '../../utils/controlIcons.js';
import { FULLSCREEN_CHANGE_EVENT, getFullscreenElement, releaseFullscreen, toggleContainerFullscreen } from '../../utils/fullscreen.js';

export interface PanoramaLiteViewerControls {
  bindVideo(video: HTMLVideoElement, media: PanoramaLiteMediaType): void;
  setMedia(media: PanoramaLiteMediaType): void;
  setVisible(visible: boolean): void;
  update(): void;
  destroy(): void;
}

interface PanoramaLiteViewerControlsConfig {
  host: HTMLElement;
  video: HTMLVideoElement;
  media: PanoramaLiteMediaType;
  options?: boolean | PanoramaLiteViewerControlsOptions;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  resetView: () => void;
  resize: () => void;
  onError: (error: unknown) => void;
}

interface NormalizedControlsOptions {
  playback: boolean;
  seek: boolean;
  loop: boolean;
  volume: boolean;
  fullscreen: boolean;
  resetView: boolean;
  className?: string;
}

const STYLE_ID = 'fyra-panoramalite-viewer-controls-style';
const HIDDEN_CLASS = 'fyra-panoramalite-hidden';

export function createPanoramaLiteViewerControls(config: PanoramaLiteViewerControlsConfig): PanoramaLiteViewerControls | null {
  const normalizedOptions = normalizeOptions(config.options);
  if (!normalizedOptions) return null;
  const options: NormalizedControlsOptions = normalizedOptions;
  injectViewerControlsStyles();

  let video = config.video;
  let media = config.media;
  const disposers: Array<() => void> = [];
  const videoDisposers: Array<() => void> = [];

  const root = document.createElement('div');
  root.className = ['fyra-panoramalite-viewer-controls', options.className].filter(Boolean).join(' ');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Panorama controls');

  const playButton = createButton('play', 'Play or pause');
  const resetButton = createButton('reset', 'Reset view');
  const loopButton = createButton('repeat', 'Loop playback');
  const muteButton = createButton('volume', 'Mute audio');
  const fullscreenButton = createButton('fullscreen', 'Toggle fullscreen');
  const timeLabel = document.createElement('span');
  timeLabel.className = 'fyra-panoramalite-time';
  const seek = document.createElement('input');
  seek.className = 'fyra-panoramalite-seek';
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1000';
  seek.step = '1';
  seek.value = '0';
  seek.setAttribute('aria-label', 'Seek');
  const volume = document.createElement('input');
  volume.className = 'fyra-panoramalite-volume';
  volume.type = 'range';
  volume.min = '0';
  volume.max = '100';
  volume.step = '1';
  volume.value = '100';
  volume.setAttribute('aria-label', 'Volume');

  root.appendChild(seek);
  const bar = document.createElement('div');
  bar.className = 'fyra-panoramalite-bar';
  const spacer = document.createElement('div');
  spacer.className = 'fyra-panoramalite-spacer';
  const volumeWrap = document.createElement('div');
  volumeWrap.className = 'fyra-panoramalite-volume-wrap';
  const volumePop = document.createElement('div');
  volumePop.className = 'fyra-panoramalite-volume-pop';
  volumePop.appendChild(volume);
  volumeWrap.appendChild(muteButton);
  volumeWrap.appendChild(volumePop);
  bar.appendChild(playButton);
  bar.appendChild(timeLabel);
  bar.appendChild(spacer);
  bar.appendChild(loopButton);
  bar.appendChild(resetButton);
  bar.appendChild(volumeWrap);
  bar.appendChild(fullscreenButton);
  root.appendChild(bar);
  config.host.appendChild(root);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let hovering = false;
  let focused = false;

  function clearHideTimer(): void {
    if (hideTimer !== null) clearTimeout(hideTimer);
    hideTimer = null;
  }

  function showControls(): void {
    root.classList.remove('fyra-panoramalite-auto-hidden');
    clearHideTimer();
    if (media === 'image' || video.paused) return;
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (!video.paused && !hovering && !focused && !root.querySelector(':focus-visible')) root.classList.add('fyra-panoramalite-auto-hidden');
    }, 3000);
  }

  const listen = (target: EventTarget, event: string, handler: EventListener) => {
    target.addEventListener(event, handler);
    disposers.push(() => target.removeEventListener(event, handler));
  };
  const listenVideo = (event: string, handler: EventListener) => {
    video.addEventListener(event, handler);
    videoDisposers.push(() => video.removeEventListener(event, handler));
  };
  const bindVideoEvents = () => {
    for (const event of ['play', 'pause', 'ended']) listenVideo(event, () => { update(); showControls(); });
    for (const event of ['timeupdate', 'durationchange', 'loadedmetadata', 'volumechange']) {
      listenVideo(event, update);
    }
  };
  const clearVideoEvents = () => {
    while (videoDisposers.length) videoDisposers.pop()?.();
  };

  listen(root, 'pointerdown', (event) => event.stopPropagation());
  listen(root, 'touchstart', (event) => { showControls(); event.stopPropagation(); });
  listen(config.host, 'pointermove', showControls);
  listen(config.host, 'pointerdown', showControls);
  listen(root, 'pointerenter', event => { if ((event as PointerEvent).pointerType === 'touch') return; hovering = true; showControls(); });
  listen(root, 'pointerleave', event => { if ((event as PointerEvent).pointerType === 'touch') return; hovering = false; showControls(); });
  listen(root, 'focusin', () => { focused = !globalThis.matchMedia?.('(pointer: coarse)').matches; showControls(); });
  listen(root, 'focusout', () => { focused = false; showControls(); });
  disposers.push(clearHideTimer);
  listen(playButton, 'click', () => {
    if (media === 'image') return;
    if (video.paused) {
      config.play().catch(config.onError);
    } else {
      config.pause().catch(config.onError);
    }
    update();
  });
  listen(resetButton, 'click', () => {
    config.resetView();
    update();
  });
  listen(loopButton, 'click', () => {
    if (media === 'image') return;
    video.loop = !video.loop;
    update();
  });
  listen(muteButton, 'click', () => {
    if (media === 'image') return;
    video.muted = !video.muted;
    update();
  });
  listen(seek, 'input', () => {
    if (!hasFiniteDuration(video)) return;
    const ratio = clampNumber(Number(seek.value) / 1000, 0, 1);
    video.currentTime = video.duration * ratio;
    update();
  });
  listen(volume, 'input', () => {
    if (media === 'image') return;
    const nextVolume = clampNumber(Number(volume.value) / 100, 0, 1);
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
    update();
  });
  listen(fullscreenButton, 'click', () => {
    toggleFullscreen(config.host).catch(config.onError).finally(() => {
      config.resize();
      update();
    });
  });
  listen(document, 'fullscreenchange', () => {
    config.resize();
    update();
  });
  listen(document, 'webkitfullscreenchange', () => {
    config.resize();
    update();
  });
  listen(document, FULLSCREEN_CHANGE_EVENT, () => { config.resize(); update(); showControls(); });

  const timer = window.setInterval(update, 500);
  disposers.push(() => window.clearInterval(timer));
  bindVideoEvents();
  update();
  showControls();

  function update(): void {
    const image = media === 'image';
    const finiteDuration = !image && hasFiniteDuration(video);
    toggleElement(playButton, options.playback && !image);
    root.classList.toggle('fyra-panoramalite-compact', config.host.clientWidth < 520);
    toggleElement(timeLabel, !image);
    toggleElement(seek, options.seek && finiteDuration);
    toggleElement(loopButton, options.loop && finiteDuration);
    toggleElement(volumeWrap, options.volume && !image);
    toggleElement(resetButton, options.resetView);
    toggleElement(fullscreenButton, options.fullscreen);

    setButtonIcon(playButton, video.paused ? 'play' : 'pause');
    playButton.title = video.paused ? 'Play' : 'Pause';
    playButton.setAttribute('aria-label', playButton.title);
    loopButton.title = video.loop ? 'Disable loop' : 'Loop playback';
    loopButton.setAttribute('aria-label', loopButton.title);
    loopButton.setAttribute('aria-pressed', String(video.loop));
    setButtonIcon(muteButton, video.muted || video.volume === 0 ? 'muted' : 'volume');
    muteButton.title = video.muted || video.volume === 0 ? 'Unmute audio' : 'Mute audio';
    muteButton.setAttribute('aria-label', muteButton.title);
    muteButton.setAttribute('aria-pressed', String(video.muted || video.volume === 0));
    setButtonIcon(fullscreenButton, isFullscreen(config.host) ? 'exitFullscreen' : 'fullscreen');
    fullscreenButton.title = isFullscreen(config.host) ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    volume.value = String(Math.round((video.muted ? 0 : video.volume) * 100));
    const played = finiteDuration ? clampNumber(video.currentTime / video.duration, 0, 1) * 100 : 0;
    seek.style.background = `linear-gradient(to right, #fff ${played}%, rgba(255,255,255,0.3) ${played}%)`;

    if (image) {
      timeLabel.textContent = '';
      seek.value = '0';
    } else if (finiteDuration) {
      const ratio = clampNumber(video.currentTime / video.duration, 0, 1);
      seek.value = String(Math.round(ratio * 1000));
      timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    } else {
      timeLabel.textContent = 'LIVE';
      seek.value = '0';
    }
  }

  return {
    bindVideo(nextVideo, nextMedia) {
      clearVideoEvents();
      video = nextVideo;
      media = nextMedia;
      bindVideoEvents();
      update();
      showControls();
    },
    setMedia(nextMedia) {
      media = nextMedia;
      update();
      showControls();
    },
    setVisible(visible) {
      toggleElement(root, visible);
      if (visible) showControls();
      else clearHideTimer();
    },
    update,
    destroy() {
      clearVideoEvents();
      while (disposers.length) disposers.pop()?.();
      root.remove();
      void releaseFullscreen(config.host).catch(() => {});
    },
  };
}

function normalizeOptions(options: boolean | PanoramaLiteViewerControlsOptions | undefined): NormalizedControlsOptions | null {
  if (options === undefined) return null;
  if (options === false) return null;
  const value = typeof options === 'object' ? options : {};
  if (value.enabled === false) return null;
  return {
    playback: value.playback !== false,
    seek: value.seek !== false,
    loop: value.loop !== false,
    volume: value.volume !== false,
    fullscreen: value.fullscreen !== false,
    resetView: value.resetView !== false,
    className: value.className,
  };
}

function createButton(icon: ControlIcon, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  setButtonIcon(button, icon);
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
}

function setButtonIcon(button: HTMLButtonElement, icon: ControlIcon): void {
  if (button.dataset.icon === icon) return;
  button.dataset.icon = icon;
  button.innerHTML = controlIconSvg(icon);
}

function toggleElement(element: HTMLElement, visible: boolean): void {
  element.classList.toggle(HIDDEN_CLASS, !visible);
}

function hasFiniteDuration(video: HTMLVideoElement): boolean {
  return Number.isFinite(video.duration) && video.duration > 0;
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

async function toggleFullscreen(host: HTMLElement): Promise<void> {
  await toggleContainerFullscreen(host);
}

function isFullscreen(host: HTMLElement): boolean {
  return getFullscreenElement() === host;
}

function injectViewerControlsStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.fyra-panoramalite-viewer-controls {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  padding-top: 8px;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: border-box;
  color: #fff;
  background: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.7) 100%);
  pointer-events: none;
  opacity: 1;
  transition: opacity 0.3s ease;
}
.fyra-panoramalite-bar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 4px;
  padding: 6px 12px 10px;
  padding-left: max(12px, env(safe-area-inset-left, 0px));
  padding-right: max(12px, env(safe-area-inset-right, 0px));
  pointer-events: auto;
  touch-action: manipulation;
}
.fyra-panoramalite-spacer { flex: 1; min-width: 0; }
.fyra-panoramalite-viewer-controls button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  min-width: 32px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #fff;
  font: 600 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  cursor: pointer;
  pointer-events: auto;
}
.fyra-panoramalite-viewer-controls button:hover {
  background: rgba(255, 255, 255, 0.12);
}
.fyra-panoramalite-viewer-controls button[aria-pressed="true"] {
  color: #93c5fd;
  background: rgba(96, 165, 250, 0.15);
}
.fyra-panoramalite-viewer-controls :focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 3px;
}
.fyra-panoramalite-viewer-controls svg {
  width: 20px;
  height: 20px;
  display: block;
  flex-shrink: 0;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,0.3));
}
.fyra-panoramalite-viewer-controls input[type="range"] {
  appearance: none;
  -webkit-appearance: none;
  accent-color: #fff;
  margin: 0;
  padding: 0;
  border: 0;
  cursor: pointer;
  pointer-events: auto;
}
.fyra-panoramalite-seek {
  width: 100%;
  height: 4px;
  min-width: 0;
  border-radius: 0;
  background: linear-gradient(to right, #fff var(--fyra-played, 0%), rgba(255,255,255,0.3) var(--fyra-played, 0%));
}
.fyra-panoramalite-viewer-controls input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.4);
}
.fyra-panoramalite-viewer-controls input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: 50%;
  background: #fff;
}
.fyra-panoramalite-volume-wrap { position: relative; display: flex; }
.fyra-panoramalite-volume-pop {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px;
  border-radius: 8px;
  background: rgba(28,28,28,0.95);
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.2s ease;
}
.fyra-panoramalite-volume-wrap:hover .fyra-panoramalite-volume-pop,
.fyra-panoramalite-volume-wrap:focus-within .fyra-panoramalite-volume-pop {
  visibility: visible;
  opacity: 1;
}
.fyra-panoramalite-volume {
  width: 6px;
  height: 80px;
  writing-mode: vertical-lr;
  direction: rtl;
  background: rgba(255,255,255,0.3);
  border-radius: 3px;
  min-width: 0;
}
.fyra-panoramalite-time {
  min-width: 38px;
  flex: 0 0 auto;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  margin-left: 4px;
  font: 500 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  white-space: nowrap;
  pointer-events: auto;
}
.fyra-panoramalite-hidden {
  display: none !important;
}
.fyra-panoramalite-auto-hidden { opacity: 0; }
.fyra-panoramalite-auto-hidden:not(:focus-within) * { pointer-events: none; }
.fyra-panoramalite-auto-hidden:focus-within { opacity: 1; }
.fyra-panoramalite-compact .fyra-panoramalite-bar { padding: 4px max(8px, env(safe-area-inset-right, 0px)) 6px max(8px, env(safe-area-inset-left, 0px)); gap: 2px; }
.fyra-panoramalite-compact button[data-icon="repeat"] {
  display: none;
}
@media (pointer: coarse) {
  .fyra-panoramalite-auto-hidden:focus-within { opacity: 0; }
  .fyra-panoramalite-auto-hidden * { pointer-events: none; }
  .fyra-panoramalite-viewer-controls button { flex-basis: 44px; width: 44px; min-width: 44px; height: 44px; }
  .fyra-panoramalite-viewer-controls .fyra-panoramalite-volume-pop { display: none; }
  .fyra-panoramalite-viewer-controls .fyra-panoramalite-seek {
    height: 24px;
    background: linear-gradient(to bottom, transparent 10px, rgba(255,255,255,0.3) 10px, rgba(255,255,255,0.3) 14px, transparent 14px) !important;
    touch-action: none;
  }
  .fyra-panoramalite-viewer-controls .fyra-panoramalite-seek::-webkit-slider-thumb { width: 18px; height: 18px; }
}
`;
  document.head?.appendChild(style);
}
