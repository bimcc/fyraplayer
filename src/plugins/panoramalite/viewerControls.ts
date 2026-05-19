import type { PanoramaLiteMediaType, PanoramaLiteViewerControlsOptions } from './types.js';

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

  const playButton = createButton('>', 'Play or pause');
  const resetButton = createButton('↺', 'Reset view');
  const loopButton = createButton('↻', 'Loop playback');
  const muteButton = createButton('♪', 'Mute audio');
  const fullscreenButton = createButton('[ ]', 'Toggle fullscreen');
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

  root.appendChild(playButton);
  root.appendChild(timeLabel);
  root.appendChild(seek);
  root.appendChild(loopButton);
  root.appendChild(muteButton);
  root.appendChild(volume);
  root.appendChild(resetButton);
  root.appendChild(fullscreenButton);
  config.host.appendChild(root);

  const listen = (target: EventTarget, event: string, handler: EventListener) => {
    target.addEventListener(event, handler);
    disposers.push(() => target.removeEventListener(event, handler));
  };
  const listenVideo = (event: string, handler: EventListener) => {
    video.addEventListener(event, handler);
    videoDisposers.push(() => video.removeEventListener(event, handler));
  };
  const bindVideoEvents = () => {
    for (const event of ['play', 'pause', 'ended', 'timeupdate', 'durationchange', 'loadedmetadata', 'volumechange']) {
      listenVideo(event, update);
    }
  };
  const clearVideoEvents = () => {
    while (videoDisposers.length) videoDisposers.pop()?.();
  };

  listen(root, 'pointerdown', (event) => event.stopPropagation());
  listen(root, 'touchstart', (event) => event.stopPropagation());
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

  const timer = window.setInterval(update, 500);
  disposers.push(() => window.clearInterval(timer));
  bindVideoEvents();
  update();

  function update(): void {
    const image = media === 'image';
    const finiteDuration = !image && hasFiniteDuration(video);
    const live = !image && !finiteDuration;
    toggleElement(playButton, options.playback && !image);
    toggleElement(timeLabel, finiteDuration);
    toggleElement(seek, options.seek && finiteDuration);
    toggleElement(loopButton, options.loop && finiteDuration);
    toggleElement(muteButton, options.volume && !image);
    toggleElement(volume, options.volume && finiteDuration);
    toggleElement(resetButton, options.resetView);
    toggleElement(fullscreenButton, options.fullscreen);

    playButton.textContent = video.paused ? '>' : 'II';
    playButton.title = video.paused ? 'Play' : 'Pause';
    playButton.setAttribute('aria-label', playButton.title);
    loopButton.textContent = '↻';
    loopButton.title = video.loop ? 'Disable loop' : 'Loop playback';
    loopButton.setAttribute('aria-label', loopButton.title);
    loopButton.setAttribute('aria-pressed', String(video.loop));
    muteButton.textContent = video.muted || video.volume === 0 ? '×' : '♪';
    muteButton.title = video.muted || video.volume === 0 ? 'Unmute audio' : 'Mute audio';
    muteButton.setAttribute('aria-label', muteButton.title);
    muteButton.setAttribute('aria-pressed', String(video.muted || video.volume === 0));
    fullscreenButton.textContent = isFullscreen(config.host) ? '□' : '[ ]';
    fullscreenButton.title = isFullscreen(config.host) ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    volume.value = String(Math.round((video.muted ? 0 : video.volume) * 100));

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
    },
    setMedia(nextMedia) {
      media = nextMedia;
      update();
    },
    setVisible(visible) {
      toggleElement(root, visible);
    },
    update,
    destroy() {
      clearVideoEvents();
      while (disposers.length) disposers.pop()?.();
      root.remove();
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

function createButton(text: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.title = title;
  button.setAttribute('aria-label', title);
  return button;
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
  if (isFullscreen(host)) {
    await exitFullscreen();
    return;
  }
  const candidate = host as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
  if (candidate.requestFullscreen) {
    await candidate.requestFullscreen();
    return;
  }
  await candidate.webkitRequestFullscreen?.();
}

async function exitFullscreen(): Promise<void> {
  const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> | void };
  if (document.exitFullscreen) {
    await document.exitFullscreen();
    return;
  }
  await doc.webkitExitFullscreen?.();
}

function isFullscreen(host: HTMLElement): boolean {
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  const element = document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
  return element === host;
}

function injectViewerControlsStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.fyra-panoramalite-viewer-controls {
  position: absolute;
  left: 50%;
  right: auto;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 24px);
  padding: 0;
  color: #f8fafc;
  background: transparent;
  border: 0;
  pointer-events: none;
}
.fyra-panoramalite-viewer-controls button {
  width: 30px;
  height: 30px;
  min-width: 30px;
  padding: 0;
  border: 1px solid rgba(226, 232, 240, 0.28);
  border-radius: 999px;
  background: rgba(7, 15, 27, 0.62);
  color: #f8fafc;
  font: 600 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  pointer-events: auto;
}
.fyra-panoramalite-viewer-controls button:hover {
  background: rgba(15, 23, 42, 0.78);
}
.fyra-panoramalite-viewer-controls input[type="range"] {
  accent-color: #22c55e;
  height: 30px;
  border-radius: 999px;
  background: rgba(7, 15, 27, 0.52);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  pointer-events: auto;
}
.fyra-panoramalite-seek {
  flex: 0 1 220px;
  width: min(220px, 30vw);
  min-width: 88px;
}
.fyra-panoramalite-volume {
  flex: 0 0 56px;
  min-width: 52px;
}
.fyra-panoramalite-time {
  min-width: 38px;
  padding: 0 8px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgba(7, 15, 27, 0.52);
  color: #cbd5e1;
  font: 600 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
  pointer-events: auto;
}
.fyra-panoramalite-hidden {
  display: none !important;
}
:fullscreen .fyra-panoramalite-viewer-controls {
  position: fixed;
  bottom: 16px;
}
@media (max-width: 560px) {
  .fyra-panoramalite-viewer-controls {
    left: 50%;
    right: auto;
    bottom: 8px;
    max-width: calc(100% - 16px);
  }
  .fyra-panoramalite-viewer-controls button {
    width: 28px;
    height: 28px;
    min-width: 28px;
  }
  .fyra-panoramalite-time {
    display: none;
  }
  .fyra-panoramalite-seek {
    width: min(170px, 42vw);
  }
  .fyra-panoramalite-volume {
    flex-basis: 52px;
  }
}
`;
  document.head?.appendChild(style);
}
