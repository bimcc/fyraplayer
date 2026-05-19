import { FyraPlayer } from '../src/index.js';
import { createPanoramaLitePlugin, type PanoramaLiteHandle } from '../src/plugins/panoramalite.js';
import type { Source } from '../src/types.js';

type SourceKind = 'image' | 'file' | 'hls' | 'dash' | 'webrtc';

const shell = document.getElementById('pano-shell') as HTMLElement;
const video = document.getElementById('video') as HTMLVideoElement;
const urlInput = document.getElementById('source-url') as HTMLInputElement;
const kindSelect = document.getElementById('source-kind') as HTMLSelectElement;
const loadButton = document.getElementById('load') as HTMLButtonElement;
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const stateEl = document.getElementById('state') as HTMLDivElement;
const viewEl = document.getElementById('view') as HTMLDivElement;
const videoInfoEl = document.getElementById('video-info') as HTMLDivElement;
const canvasInfoEl = document.getElementById('canvas-info') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLDivElement;

let player: FyraPlayer | null = null;
let handle: PanoramaLiteHandle | null = null;
let mode: SourceKind = 'image';
let renderTimer: number | null = null;

function appendLog(message: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.textContent = logEl.textContent ? `${logEl.textContent}\n${line}` : line;
  logEl.scrollTop = logEl.scrollHeight;
}

function createFixturePanoramaUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, '#d62828');
  gradient.addColorStop(0.24, '#f77f00');
  gradient.addColorStop(0.5, '#fcbf49');
  gradient.addColorStop(0.76, '#2a9d8f');
  gradient.addColorStop(1, '#264653');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  for (let x = 0; x < canvas.width; x += 128) {
    ctx.fillRect(x, 0, 2, canvas.height);
  }
  for (let y = 0; y < canvas.height; y += 128) {
    ctx.fillRect(0, y, canvas.width, 2);
  }
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 54px system-ui, sans-serif';
  ctx.fillText('PanoramaLite', 42, 96);
  ctx.font = '32px system-ui, sans-serif';
  ctx.fillText('left', 48, 270);
  ctx.fillText('front', 430, 270);
  ctx.fillText('right', 810, 270);
  return canvas.toDataURL('image/png');
}

function detectKind(url: string): SourceKind {
  const lower = url.toLowerCase();
  if (lower.endsWith('.m3u8')) return 'hls';
  if (lower.endsWith('.mpd')) return 'dash';
  if (lower.includes('/whep') || lower.startsWith('http://') && lower.includes(':8889/')) return 'webrtc';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png') || lower.startsWith('data:image/')) return 'image';
  return 'file';
}

function toSource(kind: SourceKind, url: string): Source {
  if (kind === 'hls') return { type: 'hls', url, preferTech: 'hls' };
  if (kind === 'dash') return { type: 'dash', url, preferTech: 'dash' };
  if (kind === 'webrtc') return { type: 'webrtc', url, preferTech: 'webrtc' };
  return { type: 'file', url, preferTech: 'file' };
}

function startStatusLoop(): void {
  if (renderTimer !== null) window.clearInterval(renderTimer);
  renderTimer = window.setInterval(() => {
    const view = handle?.getView();
    viewEl.textContent = view
      ? `view: yaw ${view.yaw.toFixed(1)} / pitch ${view.pitch.toFixed(1)} / fov ${view.fov.toFixed(1)}`
      : 'view: -';
    videoInfoEl.textContent = `video: ${video.videoWidth || '-'}x${video.videoHeight || '-'} / t ${video.currentTime.toFixed(2)}`;
    const canvas = shell.querySelector('canvas') as HTMLCanvasElement | null;
    canvasInfoEl.textContent = canvas ? `canvas: ${canvas.width}x${canvas.height}` : 'canvas: -';
  }, 250);
}

function stopStatusLoop(): void {
  if (renderTimer !== null) {
    window.clearInterval(renderTimer);
    renderTimer = null;
  }
}

async function destroyPlayer(): Promise<void> {
  if (player) {
    const old = player;
    player = null;
    await old.destroy().catch(() => undefined);
  }
  handle?.destroy();
  handle = null;
  stopStatusLoop();
  video.removeAttribute('src');
  video.load();
}

function bindEvents(nextPlayer: FyraPlayer): void {
  nextPlayer.on('ready', () => {
    stateEl.textContent = 'state: ready';
    appendLog('ready');
  });
  nextPlayer.on('play', () => {
    stateEl.textContent = 'state: playing';
  });
  nextPlayer.on('pause', () => {
    stateEl.textContent = 'state: paused';
  });
  nextPlayer.on('error', (error) => {
    stateEl.textContent = 'state: error';
    appendLog(`error: ${error instanceof Error ? error.message : String(error)}`);
  });
  nextPlayer.on('network', (event) => {
    appendLog(`network: ${event?.code || event?.type || 'event'}`);
  });
  nextPlayer.on('qos', (event) => {
    if (String(event?.code || '').startsWith('PANORAMALITE')) {
      appendLog(`qos: ${event?.code}`);
    }
  });
}

async function loadCurrent(): Promise<void> {
  await destroyPlayer();
  mode = kindSelect.value as SourceKind;
  const url = urlInput.value.trim() || createFixturePanoramaUrl();
  urlInput.value = url;
  stateEl.textContent = 'state: loading';
  appendLog(`load ${mode}`);

  const plugins = [
    createPanoramaLitePlugin({
      target: shell,
      media: mode === 'image' ? 'image' : 'video',
      image: mode === 'image' ? url : undefined,
      crossOrigin: 'anonymous',
      preserveDrawingBuffer: true,
      onReady: (nextHandle) => {
        handle = nextHandle;
      },
      onError: (error) => appendLog(`panoramalite error: ${error instanceof Error ? error.message : String(error)}`),
    }),
  ];

  if (mode === 'image') {
    player = new FyraPlayer({
      video,
      sources: [{ type: 'file', url: 'about:blank', preferTech: 'file' }],
      plugins,
    });
    stateEl.textContent = 'state: image';
    startStatusLoop();
    return;
  }

  player = new FyraPlayer({
    video,
    sources: [toSource(mode, url)],
    techOrder: ['webrtc', 'hls', 'dash', 'fmp4', 'file'],
    muted: true,
    plugins,
  });
  bindEvents(player);
  await player.init();
  await player.play().catch((error) => appendLog(`play blocked: ${error?.message || error}`));
  startStatusLoop();
}

loadButton.onclick = () => {
  loadCurrent().catch((error) => {
    stateEl.textContent = 'state: error';
    appendLog(`load failed: ${error?.message || error}`);
  });
};

resetButton.onclick = () => {
  handle?.resetView();
};

urlInput.value = createFixturePanoramaUrl();
kindSelect.value = detectKind(urlInput.value);
kindSelect.onchange = () => {
  const selected = kindSelect.value as SourceKind;
  if (selected === 'image') {
    urlInput.value = createFixturePanoramaUrl();
  } else if (urlInput.value.startsWith('data:image/')) {
    urlInput.value = selected === 'hls'
      ? 'https://cdn.bitmovin.com/content/assets/playhouse-vr/m3u8s/105560.m3u8'
      : selected === 'dash'
        ? 'https://cdn.bitmovin.com/content/assets/playhouse-vr/mpds/105560.mpd'
        : selected === 'webrtc'
          ? 'http://127.0.0.1:28889/live/test/whep'
          : 'https://cdn.bitmovin.com/content/assets/playhouse-vr/progressive.mp4';
  }
};

(window as any).panoramaLiteDemo = {
  load: loadCurrent,
  destroy: destroyPlayer,
  getHandle: () => handle,
  getPlayer: () => player,
  getCanvas: () => shell.querySelector('canvas'),
  setSource(kind: SourceKind, url: string) {
    kindSelect.value = kind;
    urlInput.value = url;
  },
};

void loadCurrent();
