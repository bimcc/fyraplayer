import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {
    browser: 'edge',
    scenario: 'image',
    duration: '4s',
    port: 4196,
    headless: true,
    failOnError: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const readValue = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      i += 1;
      return value;
    };
    switch (key) {
      case 'browser':
        out.browser = readValue();
        break;
      case 'browser-path':
        out.browserPath = readValue();
        break;
      case 'cdp-port':
        out.cdpPort = Number(readValue());
        break;
      case 'scenario':
        out.scenario = readValue();
        break;
      case 'source-url':
        out.sourceUrl = readValue();
        break;
      case 'duration':
        out.duration = readValue();
        break;
      case 'url':
        out.url = readValue();
        break;
      case 'port':
        out.port = Number(readValue());
        break;
      case 'out':
        out.out = readValue();
        break;
      case 'headed':
        out.headless = false;
        break;
      case 'headless':
        out.headless = true;
        break;
      case 'fail-on-error':
        out.failOnError = true;
        break;
      case 'keep-browser':
        out.keepBrowser = true;
        break;
      case 'help':
        out.help = true;
        break;
      default:
        throw new Error(`Unknown option --${key}`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage:
  node checks/panoramalite-smoke.mjs [options]

Options:
  --scenario image|file|hls|dash|webrtc
  --source-url URL                 Override the scenario source URL
  --duration 4s                    Browser sampling duration
  --browser edge|chrome
  --browser-path PATH
  --url http://127.0.0.1:4196/panoramalite.html
  --out .fyra-long-run/panoramalite-image.json
  --fail-on-error
  --headed
`);
}

function parseDuration(value) {
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const factor = unit === 'm' ? 60_000 : unit === 's' ? 1000 : 1;
  return Math.round(amount * factor);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function isPortFree(port) {
  return new Promise((resolvePort) => {
    const server = net.createServer();
    server.once('error', () => resolvePort(false));
    server.once('listening', () => {
      server.close(() => resolvePort(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 100; port += 1) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found from ${start}`);
}

async function fetchWithTimeout(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForUrl(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetchWithTimeout(url, 2000);
      if (res.ok || res.status < 500) return res;
      lastError = new Error(`${label} returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message || 'unknown error'}`);
}

function findBrowserExecutable(options) {
  if (options.browserPath) {
    if (!existsSync(options.browserPath)) throw new Error(`Browser path not found: ${options.browserPath}`);
    return options.browserPath;
  }
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [];
  if (options.browser === 'chrome') {
    if (programFiles) candidates.push(join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (programFilesX86) candidates.push(join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (localAppData) candidates.push(join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
  } else {
    if (programFilesX86) candidates.push(join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    if (programFiles) candidates.push(join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    if (localAppData) candidates.push(join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable');
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Could not find ${options.browser}. Pass --browser-path explicitly.`);
  return found;
}

function spawnVite(port) {
  const viteArgs = ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args = process.platform === 'win32' ? ['/c', 'pnpm', ...viteArgs] : viteArgs;
  const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.output = () => output.slice(-4000);
  return child;
}

function spawnBrowser(browserPath, cdpPort, profileDir, pageUrl, options) {
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-allow-origins=*',
    `--user-data-dir=${profileDir}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-component-update',
    '--disable-extensions',
    '--disable-sync',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--enable-automation',
    '--disable-infobars',
    '--disable-search-engine-choice-screen',
    '--no-service-autorun',
  ];
  if (options.headless) args.unshift('--headless=new');
  args.push(pageUrl);
  return spawn(browserPath, args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
}

async function getJson(url) {
  const res = await fetchWithTimeout(url, 5000);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function getDemoPage(cdpPort, pageUrl) {
  const pages = await getJson(`http://127.0.0.1:${cdpPort}/json`);
  const page = pages.find((item) => item.type === 'page' && item.url === pageUrl)
    || pages.find((item) => item.type === 'page' && item.url.includes('/panoramalite.html'))
    || pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable browser page found');
  return page;
}

class CdpSession {
  constructor(webSocketUrl) {
    if (typeof WebSocket !== 'function') throw new Error('Global WebSocket is unavailable. Use Node 22+.');
    this.ws = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.ws.addEventListener('open', resolveReady, { once: true });
      this.ws.addEventListener('error', rejectReady, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}, timeoutMs = 60_000) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        rejectSend(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

function defaultUrlForScenario(scenario) {
  if (scenario === 'file') return 'https://cdn.bitmovin.com/content/assets/playhouse-vr/progressive.mp4';
  if (scenario === 'hls') return 'https://cdn.bitmovin.com/content/assets/playhouse-vr/m3u8s/105560.m3u8';
  if (scenario === 'dash') return 'https://cdn.bitmovin.com/content/assets/playhouse-vr/mpds/105560.mpd';
  if (scenario === 'webrtc') return 'http://127.0.0.1:28889/live/test/whep';
  return '';
}

async function runInBrowser(session, options) {
  const expression = `
(async (options) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (predicate, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await predicate();
        if (last) return last;
      } catch (error) {
        last = error;
      }
      await sleep(100);
    }
    throw new Error('Timed out waiting for ' + label + ': ' + (last?.message || last || 'no value'));
  };
  const samplePixels = (canvas) => {
    const gl = canvas.getContext('webgl2');
    if (!gl) return { error: 'no webgl2 context' };
    const points = [
      [0.2, 0.2], [0.5, 0.2], [0.8, 0.2],
      [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
      [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]
    ];
    const pixel = new Uint8Array(4);
    const samples = [];
    let nonBlack = 0;
    for (const [fx, fy] of points) {
      const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(canvas.width * fx)));
      const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(canvas.height * fy)));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      const value = Array.from(pixel);
      if (value[0] + value[1] + value[2] > 24 && value[3] > 0) nonBlack += 1;
      samples.push({ x, y, value });
    }
    const unique = new Set(samples.map((item) => item.value.join(','))).size;
    return { nonBlack, unique, samples };
  };
  const sampleDelta = (a, b) => {
    if (!a?.samples || !b?.samples) return null;
    let delta = 0;
    for (let i = 0; i < Math.min(a.samples.length, b.samples.length); i += 1) {
      const left = a.samples[i].value;
      const right = b.samples[i].value;
      delta += Math.abs(left[0] - right[0]) + Math.abs(left[1] - right[1]) + Math.abs(left[2] - right[2]) + Math.abs(left[3] - right[3]);
    }
    return delta;
  };

  await waitFor(() => window.panoramaLiteDemo, 10000, 'PanoramaLite demo API');
  if (options.sourceUrl) {
    window.panoramaLiteDemo.setSource(options.scenario, options.sourceUrl);
  } else if (options.scenario !== 'image') {
    window.panoramaLiteDemo.setSource(options.scenario, options.defaultUrl);
  }
  await window.panoramaLiteDemo.load();
  const canvas = await waitFor(() => window.panoramaLiteDemo.getCanvas(), 10000, 'PanoramaLite canvas');

  if (options.scenario !== 'image') {
    const video = document.getElementById('video');
    await waitFor(() => video.readyState >= 2 || window.panoramaLiteDemo.getPlayer()?.getState?.() === 'playing', 30000, 'video readiness');
    await video.play().catch(() => undefined);
  }

  await sleep(options.durationMs);
  const firstReadablePixels = await waitFor(() => {
    const pixels = samplePixels(canvas);
    return pixels.nonBlack >= 2 && pixels.unique >= 2 ? pixels : null;
  }, options.scenario === 'image' ? 5000 : 15000, 'nonblank PanoramaLite canvas');
  const beforeView = window.panoramaLiteDemo.getHandle()?.getView?.() || null;
  const beforePixels = firstReadablePixels || samplePixels(canvas);

  canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 240, clientY: 220 }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 390, clientY: 210 }));
  canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 390, clientY: 210 }));
  await sleep(500);
  const afterView = window.panoramaLiteDemo.getHandle()?.getView?.() || null;
  const afterPixels = samplePixels(canvas);
  const video = document.getElementById('video');
  const player = window.panoramaLiteDemo.getPlayer?.();
  const playbackQuality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
  const videoSnapshot = {
    readyState: video.readyState,
    currentTime: video.currentTime,
    width: video.videoWidth,
    height: video.videoHeight,
    totalFrames: playbackQuality?.totalVideoFrames ?? null,
    droppedFrames: playbackQuality?.droppedVideoFrames ?? null,
    error: video.error ? { code: video.error.code, message: video.error.message } : null
  };
  const playerState = player?.getState?.() || null;

  await window.panoramaLiteDemo.destroy();
  await sleep(200);

  return JSON.stringify({
    scenario: options.scenario,
    sourceUrl: options.sourceUrl || options.defaultUrl || null,
    userAgent: navigator.userAgent,
    canvas: {
      width: canvas.width,
      height: canvas.height,
      beforePixels,
      afterPixels,
      pixelDelta: sampleDelta(beforePixels, afterPixels),
      countAfterDestroy: document.querySelectorAll('#pano-shell canvas').length
    },
    view: {
      before: beforeView,
      after: afterView,
      changed: !!beforeView && !!afterView && (
        Math.abs(beforeView.yaw - afterView.yaw) > 0.1 ||
        Math.abs(beforeView.pitch - afterView.pitch) > 0.1 ||
        Math.abs(beforeView.fov - afterView.fov) > 0.1
      )
    },
    video: videoSnapshot,
    playerState,
    log: document.getElementById('log')?.textContent || ''
  });
})(${JSON.stringify(options)})
`;

  await session.send('Runtime.enable');
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, options.durationMs + 90_000);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  }
  return JSON.parse(result.result.value);
}

function summarize(report) {
  const nonBlack = report.canvas?.beforePixels?.nonBlack ?? 0;
  const unique = report.canvas?.beforePixels?.unique ?? 0;
  const pixelDelta = report.canvas?.pixelDelta ?? 0;
  const videoReady = report.scenario === 'image'
    || (report.video?.readyState >= 2 && (report.video?.currentTime > 0 || (report.video?.totalFrames ?? 0) > 0));
  return {
    scenario: report.scenario,
    canvasReady: report.canvas?.width > 0 && report.canvas?.height > 0,
    nonBlankCanvas: nonBlack >= 2 && unique >= 2,
    viewChanged: !!report.view?.changed,
    pixelChangedAfterDrag: pixelDelta > 24,
    videoReady,
    destroyedCanvas: report.canvas?.countAfterDestroy === 0,
    pixelDelta,
    nonBlack,
    unique,
    playerState: report.playerState,
  };
}

function stopChild(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill();
  } catch {
    // ignore
  }
}

async function removeDirectoryBestEffort(path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const durationMs = parseDuration(options.duration);
  if (!['image', 'file', 'hls', 'dash', 'webrtc'].includes(options.scenario)) {
    throw new Error(`Invalid --scenario: ${options.scenario}`);
  }

  let server = null;
  let browser = null;
  let session = null;
  let profileDir = null;
  try {
    const pageUrl = options.url || `http://127.0.0.1:${options.port}/panoramalite.html`;
    if (!options.url) {
      if (!(await isPortFree(options.port))) options.port = await findFreePort(options.port + 1);
      server = spawnVite(options.port);
      await waitForUrl(pageUrl, 30_000, 'Vite PanoramaLite demo').catch((error) => {
        throw new Error(`${error.message}\nVite output:\n${server.output()}`);
      });
    } else {
      await waitForUrl(pageUrl, 10_000, 'existing PanoramaLite demo page');
    }

    const cdpPort = options.cdpPort && await isPortFree(options.cdpPort)
      ? options.cdpPort
      : await findFreePort(options.cdpPort || 9340);
    const browserPath = findBrowserExecutable(options);
    profileDir = join(tmpdir(), `fyraplayer-panoramalite-cdp-${process.pid}-${Date.now()}`);
    mkdirSync(profileDir, { recursive: true });
    browser = spawnBrowser(browserPath, cdpPort, profileDir, pageUrl, options);
    await waitForUrl(`http://127.0.0.1:${cdpPort}/json/version`, 30_000, 'browser CDP');
    const page = await getDemoPage(cdpPort, pageUrl);
    session = new CdpSession(page.webSocketDebuggerUrl);
    let report;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        report = await runInBrowser(session, {
          scenario: options.scenario,
          sourceUrl: options.sourceUrl,
          defaultUrl: defaultUrlForScenario(options.scenario),
          durationMs,
        });
        break;
      } catch (error) {
        const message = error?.message || String(error);
        if (attempt === 1 || !message.includes('Execution context was destroyed')) throw error;
        await sleep(1000);
      }
    }
    if (!report) throw new Error('PanoramaLite smoke did not produce a report');
    report.summary = summarize(report);
    report.browser = basename(browserPath);

    if (options.out) {
      const outputPath = resolve(root, options.out);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      report.outputPath = outputPath;
    }

    console.log(JSON.stringify({
      browser: report.browser,
      source: { scenario: report.scenario, url: report.sourceUrl },
      outputPath: report.outputPath,
      summary: report.summary,
    }, null, 2));

    if (options.failOnError) {
      const failed = !report.summary.canvasReady
        || !report.summary.nonBlankCanvas
        || !report.summary.viewChanged
        || !report.summary.pixelChangedAfterDrag
        || !report.summary.videoReady
        || !report.summary.destroyedCanvas;
      if (failed) process.exitCode = 1;
    }
  } finally {
    session?.close();
    if (!options.keepBrowser) stopChild(browser);
    stopChild(server);
    if (!options.keepBrowser && profileDir) {
      await sleep(300);
      await removeDirectoryBestEffort(profileDir);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
