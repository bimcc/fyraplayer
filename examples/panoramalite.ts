import { FyraPlayer } from '../src/index.js';
import { createPanoramaLitePlugin, type PanoramaLiteHandle } from '../src/plugins/panoramalite.js';
import type { Source } from '../src/types.js';

type SourceKind = 'image' | 'file' | 'hls' | 'dash' | 'webrtc';

const shell = document.getElementById('pano-shell') as HTMLElement;
const video = document.getElementById('video') as HTMLVideoElement;
const presetSelect = document.getElementById('source-preset') as HTMLSelectElement;
const urlInput = document.getElementById('source-url') as HTMLInputElement;
const kindSelect = document.getElementById('source-kind') as HTMLSelectElement;
const panoramaEnabledInput = document.getElementById('panorama-enabled') as HTMLInputElement;
const flipXInput = document.getElementById('flip-x') as HTMLInputElement;
const flipYInput = document.getElementById('flip-y') as HTMLInputElement;
const loadButton = document.getElementById('load') as HTMLButtonElement;
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const pluginsToggleButton = document.getElementById('plugins-toggle') as HTMLButtonElement;
const pluginPanel = document.getElementById('plugin-panel') as HTMLDivElement;
const pluginConfiguredEl = document.getElementById('plugin-configured') as HTMLSpanElement;
const pluginActiveEl = document.getElementById('plugin-active') as HTMLSpanElement;
const pluginModeEl = document.getElementById('plugin-mode') as HTMLSpanElement;
const stateEl = document.getElementById('state') as HTMLDivElement;
const viewEl = document.getElementById('view') as HTMLDivElement;
const videoInfoEl = document.getElementById('video-info') as HTMLDivElement;
const canvasInfoEl = document.getElementById('canvas-info') as HTMLDivElement;
const logEl = document.getElementById('log') as HTMLDivElement;

let player: FyraPlayer | null = null;
let handle: PanoramaLiteHandle | null = null;
let mode: SourceKind = 'image';
let renderTimer: number | null = null;
const smokeMode = new URLSearchParams(window.location.search).has('smoke');
const NAVER_PANORAMA_HLS_URL = 'https://naver.github.io/egjs-view360/pano/equirect/m3u8/equi.m3u8';
const RADIANT_PANORAMA_HLS_URL = 'https://cdn.radiantmediatechs.com/rmp/media/samples-for-rmp-site/04052024-lac-de-bimont/hls/playlist.m3u8';
const ELECTROTEQUE_PANORAMA_HLS_URL = 'https://videos.electroteque.org/360/hls/ultra_light_flight.m3u8';
const MEDIAMTX_HLS_URL = 'http://127.0.0.1:28888/live/test/index.m3u8';
const MEDIAMTX_WHEP_URL = 'http://127.0.0.1:28889/live/test/whep';
const LOCAL_MP4_URL = '/testvideo/Rec%200017.mp4';
const GENERIC_DASH_URL = 'https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd';

const presetSources: Record<string, { kind: SourceKind; url: string | (() => string) }> = {
  'generated-image': { kind: 'image', url: createFixturePanoramaUrl },
  'naver-hls': { kind: 'hls', url: NAVER_PANORAMA_HLS_URL },
  'radiant-hls': { kind: 'hls', url: RADIANT_PANORAMA_HLS_URL },
  'electroteque-hls': { kind: 'hls', url: ELECTROTEQUE_PANORAMA_HLS_URL },
  'mediamtx-hls': { kind: 'hls', url: MEDIAMTX_HLS_URL },
  'mediamtx-webrtc': { kind: 'webrtc', url: MEDIAMTX_WHEP_URL },
  'local-mp4': { kind: 'file', url: LOCAL_MP4_URL },
};

function appendLog(message: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logEl.textContent = logEl.textContent ? `${logEl.textContent}\n${line}` : line;
  logEl.scrollTop = logEl.scrollHeight;
}

function createFixturePanoramaUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable');
  const { width, height } = canvas;
  const centerX = width / 2;
  const centerY = height / 2;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0b1220');
  gradient.addColorStop(0.42, '#12343f');
  gradient.addColorStop(0.68, '#2f5f4c');
  gradient.addColorStop(1, '#f2c14e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';

  for (let lon = -180; lon <= 180; lon += 15) {
    const x = ((lon + 180) / 360) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    if (lon % 45 === 0) {
      ctx.fillText(`${lon}deg`, x + 8, centerY - 18);
    }
  }

  for (let lat = -75; lat <= 75; lat += 15) {
    const y = ((90 - lat) / 180) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    if (lat % 30 === 0) {
      ctx.fillText(`${lat}deg`, centerX + 18, y - 8);
    }
  }

  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffd166';
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  ctx.strokeStyle = '#ef476f';
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, height);
  ctx.stroke();

  ctx.strokeStyle = '#06d6a0';
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(0, height);
  ctx.moveTo(width, centerY);
  ctx.lineTo(width, height);
  ctx.stroke();

  ctx.fillStyle = 'rgba(7, 15, 27, 0.72)';
  ctx.fillRect(36, 34, 620, 116);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 58px system-ui, sans-serif';
  ctx.fillText('PanoramaLite Grid', 64, 105);
  ctx.font = '28px system-ui, sans-serif';
  ctx.fillText('yellow = equator / red = front meridian', 66, 138);

  drawLabel(ctx, centerX, centerY, 'FRONT 0deg', '#ef476f');
  drawLabel(ctx, width * 0.75, centerY, 'RIGHT 90deg', '#118ab2');
  drawLabel(ctx, width - 86, centerY, 'BACK 180deg', '#06d6a0', 'right');
  drawLabel(ctx, 86, centerY, 'BACK -180deg', '#06d6a0', 'left');
  drawLabel(ctx, width * 0.25, centerY, 'LEFT -90deg', '#f77f00');
  drawLabel(ctx, centerX, 86, 'NORTH / UP', '#ffffff');
  drawLabel(ctx, centerX, height - 86, 'SOUTH / DOWN', '#ffffff');

  return canvas.toDataURL('image/png');
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  color: string,
  align: CanvasTextAlign = 'center'
): void {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 42px system-ui, sans-serif';
  const metrics = ctx.measureText(text);
  const padX = 22;
  const boxWidth = metrics.width + padX * 2;
  const boxHeight = 64;
  const left = align === 'right' ? x - boxWidth : align === 'left' ? x : x - boxWidth / 2;
  ctx.fillStyle = 'rgba(7, 15, 27, 0.78)';
  ctx.fillRect(left, y - boxHeight / 2, boxWidth, boxHeight);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(left, y - boxHeight / 2, boxWidth, boxHeight);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y + 1);
  ctx.restore();
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

function syncOrientationDefaults(): void {
  flipXInput.checked = false;
  flipYInput.checked = false;
}

function defaultUrlForKind(kind: SourceKind): string {
  if (kind === 'image') return createFixturePanoramaUrl();
  if (kind === 'hls') return NAVER_PANORAMA_HLS_URL;
  if (kind === 'webrtc') return MEDIAMTX_WHEP_URL;
  if (kind === 'dash') return GENERIC_DASH_URL;
  return LOCAL_MP4_URL;
}

function applyPreset(value: string): void {
  const preset = presetSources[value];
  if (!preset) return;
  kindSelect.value = preset.kind;
  urlInput.value = typeof preset.url === 'function' ? preset.url() : preset.url;
  syncOrientationDefaults();
}

function updatePluginPanel(): void {
  const enabled = handle?.isEnabled() ?? panoramaEnabledInput.checked;
  const activePlugins = handle ? [`panoramalite:${enabled ? 'on' : 'standby'}`] : [];
  pluginConfiguredEl.textContent = 'panoramalite';
  pluginActiveEl.textContent = activePlugins.length ? activePlugins.join(', ') : 'none';
  pluginModeEl.textContent = enabled
    ? `panorama renderer / ${mode}`
    : `ordinary video / ${mode}`;
}

function startStatusLoop(): void {
  if (renderTimer !== null) window.clearInterval(renderTimer);
  renderTimer = window.setInterval(() => {
    const view = handle?.getView();
    viewEl.textContent = view
      ? `view: yaw ${view.yaw.toFixed(1)} / pitch ${view.pitch.toFixed(1)} / roll ${view.roll.toFixed(1)} / fov ${view.fov.toFixed(1)}`
      : 'view: -';
    videoInfoEl.textContent = `video: ${video.videoWidth || '-'}x${video.videoHeight || '-'} / t ${video.currentTime.toFixed(2)}`;
    const canvas = shell.querySelector('canvas') as HTMLCanvasElement | null;
    canvasInfoEl.textContent = canvas ? `canvas: ${canvas.width}x${canvas.height}` : 'canvas: -';
    updatePluginPanel();
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
      enabled: panoramaEnabledInput.checked,
      crossOrigin: 'anonymous',
      powerPreference: 'high-performance',
      preserveDrawingBuffer: smokeMode,
      viewerControls: true,
      textureFlipX: flipXInput.checked,
      textureFlipY: flipYInput.checked,
      onReady: (nextHandle) => {
        handle = nextHandle;
        updatePluginPanel();
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

panoramaEnabledInput.onchange = () => {
  handle?.setEnabled(panoramaEnabledInput.checked);
  updatePluginPanel();
};

pluginsToggleButton.onclick = () => {
  const expanded = pluginPanel.hidden;
  pluginPanel.hidden = !expanded;
  pluginsToggleButton.setAttribute('aria-expanded', String(expanded));
  updatePluginPanel();
};

presetSelect.value = 'generated-image';
applyPreset(presetSelect.value);
updatePluginPanel();
presetSelect.onchange = () => {
  if (presetSelect.value === 'custom') return;
  applyPreset(presetSelect.value);
};
urlInput.oninput = () => {
  presetSelect.value = 'custom';
};
kindSelect.onchange = () => {
  const selected = kindSelect.value as SourceKind;
  presetSelect.value = 'custom';
  syncOrientationDefaults();
  if (urlInput.value.startsWith('data:image/') || !urlInput.value.trim()) {
    urlInput.value = defaultUrlForKind(selected);
  }
};

(window as any).panoramaLiteDemo = {
  load: loadCurrent,
  destroy: destroyPlayer,
  getHandle: () => handle,
  getPlayer: () => player,
  getCanvas: () => shell.querySelector('canvas'),
  setSource(kind: SourceKind, url: string) {
    presetSelect.value = 'custom';
    kindSelect.value = kind;
    urlInput.value = url;
    syncOrientationDefaults();
  },
};

void loadCurrent();
