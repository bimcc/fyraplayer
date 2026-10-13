import { FyraPlayer } from '../src/player.js';
import type { Source } from '../src/types.js';
import { createUiComponentsPlugin } from '../src/plugins/ui-components.js';
import { createPlaybackHealthPlugin, type PlaybackHealthHandle } from '../src/plugins/playback-health.js';
import { createWebTransportTechPlugin } from '../src/plugins/webtransport.js';
import { MultiViewCoordinator, type MultiViewSnapshot, type MultiViewResource } from './integrations/multiview.js';

type Tile = { id: string; root: HTMLElement; host: HTMLElement; video: HTMLVideoElement;
  input: HTMLInputElement; type: HTMLSelectElement; state: HTMLElement; observation: HTMLElement;
  start: HTMLButtonElement; stop: HTMLButtonElement; focus: HTMLButtonElement;
  player?: FyraPlayer; health?: PlaybackHealthHandle; };
const tiles = new Map<string, Tile>();
const grid = document.getElementById('grid')!;
const labels = { disabled: '已停止', offscreen: '离屏释放', background: '后台释放', queued: '等待名额',
  starting: '启动中', active: '已启动', releasing: '释放中', error: '需要重试' };
const coordinator = new MultiViewCoordinator({ maxActive: 4, maxStarting: 2, startupTimeoutMs: 20000, onChange: render });
function render(snapshot: MultiViewSnapshot): void {
  (document.getElementById('active-budget') as HTMLSelectElement).value = String(snapshot.maxActive);
  (document.getElementById('starting-budget') as HTMLSelectElement).value = String(snapshot.maxStarting);
  document.getElementById('summary')!.textContent = `连接 ${snapshot.allocated}/${snapshot.maxActive} · 启动中 ${snapshot.starting}/${snapshot.maxStarting}`;
  for (const entry of snapshot.tiles) {
    const tile = tiles.get(entry.id); if (!tile) continue;
    tile.root.dataset.focused = String(entry.id === snapshot.focused);
    tile.focus.setAttribute('aria-pressed', String(entry.id === snapshot.focused));
    tile.state.textContent = labels[entry.state];
    tile.state.classList.toggle('error', !!entry.error);
    tile.input.disabled = entry.enabled || entry.state === 'releasing';
    tile.type.disabled = tile.input.disabled;
    tile.start.disabled = entry.enabled && !entry.error;
    tile.start.textContent = entry.error ? '重试' : '启动';
    tile.stop.disabled = !entry.enabled;
    if (entry.error) tile.observation.textContent = entry.error;
    else if (!tile.player) tile.observation.textContent = '未占用播放资源';
  }
}
function createResource(tile: Tile): MultiViewResource {
  const type = tile.type.value as 'file' | 'hls' | 'webrtc' | 'webtransport';
  const url = tile.input.value.trim();
  if (!url) throw new Error('请输入视频地址');
  const source: Source = { type, url };
  let health: PlaybackHealthHandle | undefined;
  let firstFrame: (() => void) | undefined;
  const player = new FyraPlayer({ video: tile.video, muted: true, sources: [source],
    reconnect: { enabled: false }, loadTimeoutMs: 15000,
    plugins: [createUiComponentsPlugin({ target: tile.host }),
      ...(type === 'webtransport' ? [createWebTransportTechPlugin({ onFrame: (_frame, info) => {
        health?.reportFrame({ mediaTime: info.mediaTime, sessionEpoch: player.getPlaybackSession()?.epoch });
      } })] : []),
      createPlaybackHealthPlugin({ frameSource: type === 'webtransport' ? 'external' : 'video',
        onHandle: handle => { health = handle; },
        onEvent: event => { if (event.type === 'first-frame') firstFrame?.(); },
        onSnapshot: snapshot => {
          if (tile.player !== player) return;
          const first = snapshot.firstFrameMs === undefined ? '等待首帧' : `首帧 ${Math.round(snapshot.firstFrameMs)}ms`;
          tile.observation.textContent = `${first} · 卡顿 ${snapshot.stallCount} 次${snapshot.lastError ? ` · ${snapshot.lastError.message}` : ''}`;
        }
      })]
  });
  tile.player = player; tile.health = health; tile.video.loop = type === 'file';
  player.on('error', error => { if (tile.player === player) coordinator.fail(tile.id, error); });
  player.on('stop', () => { if (tile.player === player) coordinator.setEnabled(tile.id, false); });
  return {
    async start(signal) {
      const abort = () => { void player.destroy().catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try {
        signal.throwIfAborted();
        await player.init(); signal.throwIfAborted();
        if (player.getState() === 'error') throw new Error('视频加载失败，请检查地址、类型和服务状态');
        // HLS may resolve init before its manifest/media attachment emits ready.
        if (player.getState() === 'loading') await new Promise<void>((resolve, reject) => {
          const cleanup = () => { player.off('ready', ready); player.off('error', failed); signal.removeEventListener('abort', cancel); };
          const ready = () => { cleanup(); resolve(); };
          const failed = (error: unknown) => { cleanup(); reject(error); };
          const cancel = () => failed(signal.reason);
          player.on('ready', ready); player.on('error', failed); signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) cancel();
        });
        signal.throwIfAborted();
        await player.play(); signal.throwIfAborted();
        if (player.getState() === 'error') throw new Error('视频无法播放');
        if (player.getVideoElement().paused) throw new Error('浏览器未允许播放，请点击重试');
        // Keep the startup slot until a real frame is observed, not only Tech.ready.
        if (health?.snapshot().firstFrameMs === undefined) await new Promise<void>((resolve, reject) => {
          const cleanup = () => { firstFrame = undefined; signal.removeEventListener('abort', cancel); player.off('error', fail); };
          const cancel = () => { cleanup(); reject(signal.reason); };
          const fail = (error: unknown) => { cleanup(); reject(error); };
          firstFrame = () => { cleanup(); resolve(); };
          signal.addEventListener('abort', cancel, { once: true }); player.on('error', fail);
          if (signal.aborted) cancel();
        });
      } finally { signal.removeEventListener('abort', abort); }
    },
    async destroy() {
      await player.destroy();
      if (tile.player === player) { tile.player = undefined; tile.health = undefined; }
    }
  };
}

for (let index = 1; index <= 4; index++) {
  const id = String(index), root = document.createElement('section');
  root.className = 'tile'; root.dataset.tile = id;
  root.innerHTML = `<div class="tile-header"><h2>窗口 ${id}</h2><span class="state">已停止</span></div>
    <div class="player-shell" aria-label="窗口 ${id} 播放器"><video playsinline muted></video></div>
    <div class="source-form"><input aria-label="窗口 ${id} 视频地址" placeholder="视频或流地址" />
    <select aria-label="窗口 ${id} 视频类型"><option value="file">文件 / MP4</option><option value="hls">HLS</option><option value="webrtc">WebRTC WHEP</option><option value="webtransport">WebTransport</option></select>
    <button data-action="start" type="button">启动</button><button data-action="stop" type="button" disabled>停止</button><button data-action="focus" type="button" aria-pressed="false">优先显示</button></div>
    <p class="observation">未占用播放资源</p>`;
  grid.append(root);
  const tile: Tile = { id, root, host: root.querySelector('.player-shell')!, video: root.querySelector('video')!,
    input: root.querySelector('input')!, type: root.querySelector('select')!, state: root.querySelector('.state')!,
    observation: root.querySelector('.observation')!, start: root.querySelector('[data-action="start"]')!,
    stop: root.querySelector('[data-action="stop"]')!, focus: root.querySelector('[data-action="focus"]')! };
  tile.input.value = '/testvideo/Rec%200017.mp4';
  tiles.set(id, tile); coordinator.add({ id, visible: false, create: () => createResource(tile) });
  tile.start.onclick = () => { coordinator.retry(id); coordinator.setEnabled(id, true); };
  tile.stop.onclick = () => coordinator.setEnabled(id, false);
  tile.focus.onclick = () => coordinator.focus(id);
  tile.host.addEventListener('pointerdown', () => coordinator.focus(id));
  tile.host.addEventListener('focusin', () => coordinator.focus(id));
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) coordinator.setVisible((entry.target as HTMLElement).dataset.tile!, entry.isIntersecting);
}, { threshold: 0 });
tiles.forEach(tile => observer.observe(tile.root));
const visibility = () => coordinator.setPageVisible(!document.hidden);
document.addEventListener('visibilitychange', visibility); visibility();
document.getElementById('start-all')!.onclick = () => tiles.forEach(tile => { coordinator.retry(tile.id); coordinator.setEnabled(tile.id, true); });
document.getElementById('stop-all')!.onclick = () => tiles.forEach(tile => coordinator.setEnabled(tile.id, false));
for (const id of ['active-budget', 'starting-budget']) document.getElementById(id)!.onchange = () => coordinator.setBudget(
  Number((document.getElementById('active-budget') as HTMLSelectElement).value),
  Number((document.getElementById('starting-budget') as HTMLSelectElement).value));
window.addEventListener('pagehide', () => coordinator.setPageVisible(false));
window.addEventListener('pageshow', visibility);
// Inspection surface for deterministic browser checks; no separate scheduling path.
(window as unknown as { fyraMultiView: unknown }).fyraMultiView = { coordinator, tiles,
  async destroy() { observer.disconnect(); document.removeEventListener('visibilitychange', visibility); await coordinator.destroy(); } };
