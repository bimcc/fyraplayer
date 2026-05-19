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
    duration: '30m',
    interval: '10s',
    source: 'HLS demo',
    headless: true,
    muted: true,
    failOnError: false,
    expectLive: false,
    port: 4195
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const readValue = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
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
      case 'duration':
        out.duration = readValue();
        break;
      case 'interval':
        out.interval = readValue();
        break;
      case 'source':
        out.source = readValue();
        break;
      case 'source-url':
        out.sourceUrl = readValue();
        break;
      case 'source-type':
        out.sourceType = readValue();
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
      case 'unmuted':
        out.muted = false;
        break;
      case 'muted':
        out.muted = true;
        break;
      case 'fail-on-error':
        out.failOnError = true;
        break;
      case 'expect-live':
        out.expectLive = true;
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
  node checks/browser-long-run.mjs [options]

Options:
  --source "HLS demo"              Select a preset from examples/basic.html
  --source-url URL --source-type hls
                                   Load a custom source instead of a preset
  --duration 30m                   Run duration. Supports ms, s, m, h
  --interval 10s                   Sampling interval. Supports ms, s, m, h
  --browser edge|chrome            Browser to launch
  --browser-path PATH              Explicit browser executable
  --url http://127.0.0.1:5173/basic.html
                                   Use an already running demo page
  --out .fyra-long-run/report.json Write full JSON report
  --fail-on-error                  Exit non-zero when playback is not usable
  --expect-live                    Also fail if playback ends or time stalls
  --headed                         Show the browser window
  --unmuted                        Do not force video.muted=true
`);
}

function parseDuration(value, name) {
  if (typeof value === 'number') return value;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!match) throw new Error(`Invalid ${name}: ${value}`);
  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return Math.round(amount * factors[unit]);
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
    } catch (err) {
      lastError = err;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError?.message || 'unknown error'}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function findBrowserExecutable(options) {
  if (options.browserPath) {
    if (!existsSync(options.browserPath)) throw new Error(`Browser path not found: ${options.browserPath}`);
    return options.browserPath;
  }

  const candidates = [];
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;

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
  if (!found) {
    throw new Error(`Could not find ${options.browser}. Pass --browser-path explicitly.`);
  }
  return found;
}

function spawnVite(port) {
  const viteArgs = ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args = process.platform === 'win32' ? ['/c', 'pnpm', ...viteArgs] : viteArgs;
  const child = spawn(command, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });

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

function spawnBrowser(browserPath, cdpPort, profileDir, demoUrl, options) {
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
    '--disable-component-extensions-with-background-pages',
    '--disable-sync',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--enable-automation',
    '--disable-infobars',
    '--disable-search-engine-choice-screen',
    '--no-service-autorun'
  ];
  if (options.headless) args.unshift('--headless=new');
  args.push(demoUrl);

  return spawn(browserPath, args, {
    cwd: root,
    stdio: ['ignore', 'ignore', 'ignore']
  });
}

async function getJson(url) {
  const res = await fetchWithTimeout(url, 5000);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function getDemoPage(cdpPort, demoUrl) {
  const pages = await getJson(`http://127.0.0.1:${cdpPort}/json`);
  const page = pages.find((item) => item.type === 'page' && item.url === demoUrl)
    || pages.find((item) => item.type === 'page' && item.url.startsWith(demoUrl.replace(/\/basic\.html$/, '/')))
    || pages.find((item) => item.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable browser page found');
  return page;
}

class CdpSession {
  constructor(webSocketUrl) {
    if (typeof WebSocket !== 'function') {
      throw new Error('Global WebSocket is unavailable. Use Node 22+ or pass through an environment that provides WebSocket.');
    }
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

async function runInBrowser(session, runOptions) {
  const expression = `
(async (options) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitForElement = async (id, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const element = document.getElementById(id);
      if (element) return element;
      await sleep(100);
    }
    throw new Error('Demo element not found: #' + id);
  };
  const race = (promise, ms, fallback) => Promise.race([
    Promise.resolve(promise).catch((error) => ({
      error: error?.message || String(error),
      name: error?.name || null
    })),
    sleep(ms).then(() => fallback)
  ]);
  const video = await waitForElement('player', 10000);
  const select = await waitForElement('source-select', 10000);
  const urlInput = await waitForElement('input-url', 10000);
  const typeSelect = await waitForElement('type-select', 10000);
  const loadBtn = await waitForElement('btn-load', 10000);
  const events = [];
  const errors = [];
  const resourceEvents = [];
  const startedAt = new Date().toISOString();
  const attachPlayer = () => {
    const player = window.fyraPlayer;
    if (!player || player.__fyraLongRunAttached) return !!player;
    player.__fyraLongRunAttached = true;
    ['ready', 'play', 'pause', 'buffer', 'ended', 'error', 'stats', 'network', 'qos', 'levelSwitch'].forEach((name) => {
      player.on(name, (...args) => {
        const item = { at: Math.round(performance.now()), name };
        if (name === 'stats') item.payload = { tech: args[0]?.tech, stats: args[0]?.stats };
        else if (name === 'error') item.payload = { message: args[0]?.message || String(args[0]) };
        else item.payload = args[0] ?? null;
        events.push(item);
      });
    });
    return true;
  };

  video.muted = !!options.muted;
  video.playsInline = true;

  const optionDeadline = Date.now() + 10000;
  while (Date.now() < optionDeadline) {
    const appReady = !!window.fyraLongRun;
    const hasCustomSourceUi = options.sourceUrl && urlInput && typeSelect && loadBtn && typeof loadBtn.onclick === 'function';
    const hasPreset = !options.sourceUrl
      && typeof select?.onchange === 'function'
      && Array.from(select?.options || []).some((item) => (item.textContent || '').trim() === options.source);
    if (appReady && (hasCustomSourceUi || hasPreset)) break;
    await sleep(100);
  }

  if (options.sourceUrl) {
    urlInput.value = options.sourceUrl;
    typeSelect.value = options.sourceType || 'auto';
    loadBtn.click();
  } else {
    const option = Array.from(select.options).find((item) => (item.textContent || '').trim() === options.source);
    if (!option) {
      throw new Error('Source preset not found: ' + options.source);
    }
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const attachDeadline = Date.now() + 6000;
  while (Date.now() < attachDeadline) {
    if (attachPlayer()) break;
    await sleep(100);
  }

  const readyDeadline = Date.now() + Math.min(20000, Math.max(8000, options.durationMs));
  while (Date.now() < readyDeadline) {
    attachPlayer();
    const state = window.fyraPlayer?.getState?.();
    if (video.readyState >= 2 || state === 'ready' || state === 'playing' || state === 'error') break;
    await sleep(250);
  }

  const triggerPlay = async (phase) => {
    if (window.fyraPlayer?.play) {
      const result = await race(window.fyraPlayer.play(), 8000, { timeout: 'player.play' });
      if (result?.error || result?.timeout) errors.push({ phase, result });
      return;
    }
    const result = await race(video.play(), 8000, { timeout: 'video.play' });
    if (result?.error || result?.timeout) errors.push({ phase, result });
  };
  await triggerPlay('play-after-ready');

  const playableDeadline = Date.now() + Math.min(15000, Math.max(5000, options.durationMs));
  while (Date.now() < playableDeadline) {
    attachPlayer();
    if (video.readyState >= 2 && (!video.paused || video.currentTime > 0)) break;
    if (video.paused && video.readyState >= 2) {
      void video.play().catch(() => {});
    }
    await sleep(250);
  }

  window.fyraLongRun?.clear?.();
  window.fyraLongRun?.start?.(options.intervalMs);
  const startedCurrentTime = video.currentTime || 0;
  const sampleDeadline = Date.now() + options.durationMs;
  while (Date.now() < sampleDeadline) {
    if (video.paused && video.readyState >= 2) {
      void video.play().catch(() => {});
    }
    const resources = performance.getEntriesByType?.('resource') || [];
    for (const entry of resources.slice(-20)) {
      const name = entry.name || '';
      if (!name || resourceEvents.some((item) => item.name === name)) continue;
      if (
        name.includes('.m3u8') ||
        name.includes('.mpd') ||
        name.includes('.mp4') ||
        name.includes('.m4s') ||
        name.includes('.ts') ||
        name.includes('/whep')
      ) {
        resourceEvents.push({
          name,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
          decodedBodySize: entry.decodedBodySize
        });
      }
    }
    await sleep(Math.min(1000, Math.max(100, sampleDeadline - Date.now())));
  }
  const samples = window.fyraLongRun?.stop?.() || [];
  window.fyraLongRun?.sample?.();

  let quality = null;
  try {
    quality = window.fyraPlayer?.getQualityState?.() || null;
  } catch (error) {
    quality = { error: error?.message || String(error) };
  }

  const playbackQuality = typeof video.getVideoPlaybackQuality === 'function'
    ? video.getVideoPlaybackQuality()
    : null;
  const finalBuffered = [];
  try {
    for (let i = 0; i < video.buffered.length; i += 1) {
      finalBuffered.push([video.buffered.start(i), video.buffered.end(i)]);
    }
  } catch {
    // ignore
  }

  return JSON.stringify({
    startedAt,
    finishedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    requestedSource: options.sourceUrl
      ? { type: options.sourceType || 'auto', url: options.sourceUrl }
      : { label: options.source },
    durationMs: options.durationMs,
    intervalMs: options.intervalMs,
    startedCurrentTime,
    state: window.fyraPlayer?.getState?.() || null,
    quality,
    events,
    errors,
    samples: window.fyraLongRun?.getSamples?.() || samples,
    finalVideo: {
      src: video.src,
      currentSrc: video.currentSrc,
      networkState: video.networkState,
      currentTime: video.currentTime || 0,
      readyState: video.readyState,
      paused: video.paused,
      ended: video.ended,
      width: video.videoWidth,
      height: video.videoHeight,
      error: video.error ? { code: video.error.code, message: video.error.message } : null,
      buffered: finalBuffered,
      totalFrames: playbackQuality?.totalVideoFrames ?? null,
      droppedFrames: playbackQuality?.droppedVideoFrames ?? null
    },
    dom: {
      video: document.querySelectorAll('video').length,
      audio: document.querySelectorAll('audio').length,
      uiShell: document.querySelectorAll('fyra-ui-shell').length
    },
    resourceEvents
  });
})(${JSON.stringify(runOptions)})
`;

  await session.send('Runtime.enable');
  const result = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, runOptions.durationMs + 90_000);

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
  }
  return JSON.parse(result.result.value);
}

function summarize(report, options) {
  const samples = Array.isArray(report.samples) ? report.samples : [];
  const firstSample = samples[0] || null;
  const lastSample = samples[samples.length - 1] || null;
  const fatalNetworkEvents = report.events.filter((event) => event.name === 'network' && (event.payload?.fatal || event.payload?.severity === 'fatal'));
  const errorEvents = report.events.filter((event) => event.name === 'error');
  const firstVideo = firstSample?.video || null;
  const lastVideo = lastSample?.video || report.finalVideo || null;
  const firstTime = firstVideo?.currentTime ?? report.startedCurrentTime ?? 0;
  const lastTime = lastVideo?.currentTime ?? report.finalVideo?.currentTime ?? 0;
  const totalFrames = lastVideo?.totalFrames ?? report.finalVideo?.totalFrames ?? null;
  const droppedFrames = lastVideo?.droppedFrames ?? report.finalVideo?.droppedFrames ?? null;
  const droppedFrameRatio = totalFrames ? droppedFrames / totalFrames : null;
  const memoryStart = firstSample?.memory?.usedJSHeapSize ?? null;
  const memoryEnd = lastSample?.memory?.usedJSHeapSize ?? null;
  const domStable = samples.every((sample) =>
    sample.dom?.video === samples[0]?.dom?.video
    && sample.dom?.audio === samples[0]?.dom?.audio
    && sample.dom?.uiShell === samples[0]?.dom?.uiShell
  );
  const currentTimeAdvanced = lastTime > firstTime + 0.25;
  const playable = (lastVideo?.readyState ?? report.finalVideo?.readyState ?? 0) >= 2
    && (currentTimeAdvanced || (totalFrames ?? 0) > 0 || report.state === 'ended');
  const liveOk = !options.expectLive || (currentTimeAdvanced && !lastVideo?.ended && report.state !== 'ended');
  const hasUnresolvedFatal = fatalNetworkEvents.length > 0 && report.state === 'error';

  return {
    sampleCount: samples.length,
    state: report.state,
    tech: lastSample?.tech || report.quality?.tech || null,
    playable,
    liveOk,
    currentTimeAdvanced,
    currentTimeStart: firstTime,
    currentTimeEnd: lastTime,
    readyState: lastVideo?.readyState ?? report.finalVideo?.readyState ?? null,
    resolution: {
      width: lastVideo?.width ?? report.finalVideo?.width ?? null,
      height: lastVideo?.height ?? report.finalVideo?.height ?? null
    },
    totalFrames,
    droppedFrames,
    droppedFrameRatio,
    memoryUsedStart: memoryStart,
    memoryUsedEnd: memoryEnd,
    memoryUsedDelta: memoryStart !== null && memoryEnd !== null ? memoryEnd - memoryStart : null,
    domStable,
    fatalNetworkEventCount: fatalNetworkEvents.length,
    errorEventCount: errorEvents.length,
    hasUnresolvedFatal
  };
}

function stopChild(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  } catch {
    // ignore
  }
}

async function removeDirectoryBestEffort(path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.warn(`Warning: could not remove temporary profile ${path}: ${error?.message || error}`);
        return;
      }
      await sleep(500);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const durationMs = parseDuration(options.duration, 'duration');
  const intervalMs = parseDuration(options.interval, 'interval');
  if (durationMs < 1000) throw new Error('--duration must be at least 1s');
  if (intervalMs < 1000) throw new Error('--interval must be at least 1s');

  let server = null;
  let browser = null;
  let session = null;
  let profileDir = null;

  try {
    const demoUrl = options.url || `http://127.0.0.1:${options.port}/basic.html`;
    if (!options.url) {
      if (!(await isPortFree(options.port))) {
        options.port = await findFreePort(options.port + 1);
      }
      server = spawnVite(options.port);
      await waitForUrl(demoUrl, 30_000, 'Vite examples server').catch((error) => {
        throw new Error(`${error.message}\nVite output:\n${server.output()}`);
      });
    } else {
      await waitForUrl(demoUrl, 10_000, 'existing demo page');
    }

    const cdpPort = options.cdpPort && await isPortFree(options.cdpPort)
      ? options.cdpPort
      : await findFreePort(options.cdpPort || 9330);
    const browserPath = findBrowserExecutable(options);
    profileDir = join(tmpdir(), `fyraplayer-cdp-${process.pid}-${Date.now()}`);
    mkdirSync(profileDir, { recursive: true });
    browser = spawnBrowser(browserPath, cdpPort, profileDir, demoUrl, options);
    await waitForUrl(`http://127.0.0.1:${cdpPort}/json/version`, 30_000, 'browser CDP');

    const page = await getDemoPage(cdpPort, demoUrl);
    session = new CdpSession(page.webSocketDebuggerUrl);
    const report = await runInBrowser(session, {
      source: options.source,
      sourceUrl: options.sourceUrl,
      sourceType: options.sourceType,
      durationMs,
      intervalMs,
      muted: options.muted
    });
    report.summary = summarize(report, options);

    if (options.out) {
      const outputPath = resolve(root, options.out);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      report.outputPath = outputPath;
    }

    console.log(JSON.stringify({
      source: report.requestedSource,
      browser: basename(browserPath),
      durationMs,
      intervalMs,
      outputPath: report.outputPath,
      summary: report.summary
    }, null, 2));

    if (options.failOnError) {
      const failed = !report.summary.playable
        || !report.summary.liveOk
        || report.summary.hasUnresolvedFatal
        || report.summary.sampleCount < 2;
      if (failed) process.exitCode = 1;
    }
  } finally {
    session?.close();
    if (!options.keepBrowser) stopChild(browser);
    stopChild(server);
    if (!options.keepBrowser && profileDir) {
      await sleep(500);
      await removeDirectoryBestEffort(profileDir);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
