import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { CdpSession, spawnBrowser, findBrowserExecutable, getDemoPage } from './browser-long-run.mjs';

// Deterministic bad-address cancellation, same-instance recovery and panorama UI checks.
// Defaults to the release build; FYRA_CONTROLS_DEMO_URL can target the running Vite demo.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site-dist');
const output = resolve(process.env.FYRA_CONTROLS_OUTPUT ?? join(root, '.fyra-long-run/controls-browser'));
mkdirSync(dirname(output), { recursive: true });
const fixture = readFileSync(join(root, 'examples/testvideo/Rec 0017.mp4'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
let badRequests = 0, hangingRequests = 0, hangingClosed = 0;
let corsProbeRequests = 0, corsProbeClosed = 0;
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/no-cors.mp4') res.removeHeader('Access-Control-Allow-Origin');
  if (path === '/cors-probe-wait.mp4' && req.headers.origin) {
    corsProbeRequests++; res.on('close', () => corsProbeClosed++); return;
  }
  if (path === '/bad.m3u8') { badRequests++; res.writeHead(403); res.end('Forbidden'); return; }
  if (path === '/hang.fmp4') { hangingRequests++; res.on('close', () => hangingClosed++); return; }
  const file = resolve(site, '.' + decodeURIComponent(path));
  if (!['/fixture.mp4','/no-cors.mp4','/cors-probe-wait.mp4'].includes(path) && (!file.startsWith(site + sep) || !existsSync(file))) {
    res.writeHead(404); res.end(); return;
  }
  const data = ['/fixture.mp4','/no-cors.mp4','/cors-probe-wait.mp4'].includes(path) ? fixture : readFileSync(file);
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.mp4': 'video/mp4' }[extname(path)] ?? 'application/octet-stream';
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
    if (start > end) { res.writeHead(416); res.end(); return; }
    res.writeHead(206, { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    res.end(data.subarray(start, end + 1));
  } else {
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, 'Accept-Ranges': 'bytes' }); res.end(data);
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const demo = process.env.FYRA_CONTROLS_DEMO_URL ?? `${base.replace('127.0.0.1','localhost')}/basic.html`;
const profile = mkdtempSync(join(tmpdir(), 'fyra-controls-smoke-'));
const cdpPort = Number(process.env.FYRA_CONTROLS_CDP_PORT ?? 9512);
const report = { demo, cases: {} };
let child, session;
async function evaluate(expression) {
  const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(message);
}
async function load(type, url) {
  await until('!!document.querySelector("#btn-load") && !document.querySelector("#btn-load").disabled', 'Demo load controls are locked');
  await evaluate(`document.querySelector('#input-url').value=${JSON.stringify(url)};document.querySelector('#type-select').value=${JSON.stringify(type)};document.querySelector('#btn-load').click()`);
}
async function verifyNoMoreBadRequests() {
  await sleep(250); const count = badRequests; await sleep(1700);
  assert.equal(badRequests, count, 'Stopped HLS is still requesting the bad address');
  return count;
}
async function playFixture() {
  await load('file', `${base}/fixture.mp4`);
  await until('window.fyraPlayer?.getState() === "ready"', 'Local MP4 did not become ready');
  await evaluate('document.querySelector("video").muted=true;document.querySelector("#btn-play").click()');
  await until('document.querySelector("video").currentTime > 0.4 && !document.querySelector("video").paused', 'Local MP4 did not play after cancellation');
}
async function screenshot(suffix) {
  const rect = await evaluate(`(()=>{const r=document.querySelector('.player-shell').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`);
  const shot = await session.send('Page.captureScreenshot', { format: 'png', clip: rect });
  const path = `${output}-${suffix}.png`; writeFileSync(path, Buffer.from(shot.data, 'base64')); return path;
}
async function geometry() {
  return evaluate(`(()=>{
    const host=document.querySelector('.player-shell'),controls=host.querySelector('.fyra-panoramalite-viewer-controls'),bar=controls.querySelector('.fyra-panoramalite-bar');
    const rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right});
    const buttons=[...bar.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().width>0);
    return {host:rect(host.getBoundingClientRect()),controls:rect(controls.getBoundingClientRect()),buttons:buttons.map(b=>({icon:b.dataset.icon,svg:!!b.querySelector('svg'),text:b.textContent,rect:rect(b.getBoundingClientRect())})),background:getComputedStyle(controls).backgroundImage,seek:rect(controls.querySelector('.fyra-panoramalite-seek').getBoundingClientRect())};
  })()`);
}
function verifyGeometry(info) {
  assert(info.controls.height <= 64, 'Panorama control region is too tall');
  assert(Math.abs(info.controls.bottom - info.host.bottom) < 1, 'Controls do not sit at the bottom edge');
  assert(info.background.includes('linear-gradient'), 'Controls lack the normal skin gradient');
  assert(info.buttons.every(b => b.svg && !b.text.trim()), 'A control still uses a text icon');
  assert(info.buttons.every(b => Math.abs(b.rect.y - info.buttons[0].rect.y) < 1), 'Buttons wrap to another row');
  assert(info.buttons.every(b => b.rect.x >= info.host.x && b.rect.right <= info.host.right), 'Controls overflow the player');
  assert(info.seek.width > info.host.width - 1, 'Progress does not span the player width');
}
try {
  child = spawnBrowser(findBrowserExecutable({ browser: 'edge' }), cdpPort, profile, 'about:blank', { headless: true });
  for (let n = 0; n < 80; n++) {
    try { if ((await fetch(`http://127.0.0.1:${cdpPort}/json`)).ok) break; } catch { /* starting */ }
    await sleep(250);
  }
  const page = await getDemoPage(cdpPort, 'about:blank'); session = new CdpSession(page.webSocketDebuggerUrl);
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
  await session.send('Page.navigate', { url: demo });
  await until('!!window.fyraLongRun', 'Demo initialization failed');

  await load('hls', `${base}/bad.m3u8`);
  await until('document.querySelector("#log").textContent.includes("reconnecting")', 'Bad HLS did not reproduce retry state');
  await evaluate('window.stoppedPlayer=window.fyraPlayer;document.querySelector("#btn-pause").click()');
  assert(await evaluate('!document.querySelector("#btn-load").disabled && !document.querySelector("#input-url").disabled && window.stoppedPlayer.getState() === "idle"'), 'Pause did not immediately unlock the demo');
  report.cases.demoPause = { requests: await verifyNoMoreBadRequests(), immediateUnlock: true };
  await playFixture();
  report.cases.recoveryAfterPause = await evaluate('({time:document.querySelector("video").currentTime,frames:document.querySelector("video").getVideoPlaybackQuality().totalVideoFrames})');
  await evaluate('document.querySelector("#btn-stop").click()');

  // The SDK skin uses stop() while preserving the Player and plugins.
  await load('hls', `${base}/bad.m3u8`);
  await until('!!document.querySelector("fyra-ui-shell")?.shadowRoot.querySelector(".status-card.show")', 'Recovery status did not appear');
  assert(await evaluate(`getComputedStyle(document.querySelector('fyra-ui-shell').shadowRoot.querySelector('[data-role="cancel"]')).display !== 'none'`), 'Skin cancel button is hidden');
  await evaluate(`window.samePlayer=window.fyraPlayer;document.querySelector('fyra-ui-shell').shadowRoot.querySelector('[data-role="cancel"]').click()`);
  await until('window.samePlayer.getState() === "idle" && getComputedStyle(document.querySelector("fyra-ui-shell").shadowRoot.querySelector(".spinner")).display === "none"', 'Skin stop did not clear loading state');
  assert(await evaluate('window.fyraPlayer === window.samePlayer && !!document.querySelector("fyra-ui-shell")'), 'Skin stop destroyed its Player or UI plugin');
  await evaluate(`(()=>{const v=document.querySelector('video');for(const event of ['waiting','playing','canplay','play','timeupdate']) v.dispatchEvent(new Event(event));})()`);
  assert(await evaluate('window.samePlayer.getState() === "idle" && getComputedStyle(document.querySelector("fyra-ui-shell").shadowRoot.querySelector(".spinner")).display === "none"'), 'Stale video events restored stopped state');
  report.cases.skinCancel = { requests: await verifyNoMoreBadRequests(), sameInstance: true };
  await evaluate(`(async()=>{const p=window.samePlayer;p.getSources()[0]={type:'file',url:${JSON.stringify(`${base}/fixture.mp4`)}};document.querySelector('video').muted=true;await p.switchSource(0);await p.play()})()`);
  await until('document.querySelector("video").currentTime > 0.4', 'Same Player could not play after stop');
  report.cases.sameInstanceRecovery = { played: true };
  await evaluate(`document.querySelector('fyra-ui-shell').shadowRoot.querySelector('.bar [data-act="stop"]').click()`);
  await until('window.samePlayer.getState() === "idle"', 'Normal toolbar stop did not stop playback');
  report.cases.skinToolbarStop = { stopped: true };
  await evaluate('document.querySelector("#btn-stop").click()');

  await load('fmp4', `${base}/hang.fmp4`);
  // sourceopen can report ready before HTTP headers arrive; assert the pending
  // request instead of depending on a transient loading state/button state.
  for (let n = 0; n < 100 && !hangingRequests; n++) await sleep(100);
  assert(hangingRequests > 0, 'The hung endpoint was never requested');
  assert.equal(hangingClosed, 0, 'The hung HTTP request closed before cancellation');
  await evaluate('document.querySelector("#btn-stop").click()');
  assert(await evaluate('!document.querySelector("#btn-load").disabled && !document.querySelector("#btn-play").disabled'), 'Stop was queued behind the pending HTTP load');
  for (let n = 0; n < 100 && !hangingClosed; n++) await sleep(100);
  assert(hangingClosed > 0, 'Stop did not abort the pending HTTP connection');
  report.cases.pendingHttp = { requests: hangingRequests, closed: hangingClosed, immediateUnlock: true };
  await playFixture(); report.cases.recoveryAfterPendingHttp = { played: true };

  const qualityHidden = `getComputedStyle(document.querySelector('fyra-ui-shell').shadowRoot.querySelector('.quality')).display === 'none'`;
  assert(await evaluate(qualityHidden), 'Empty quality control is visible');
  await session.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  assert(await evaluate(`getComputedStyle(document.querySelector('fyra-ui-shell').shadowRoot.querySelector('.quality-menu-row')).display === 'none'`), 'Empty mobile quality selector is visible');
  await evaluate(`document.querySelector('fyra-ui-shell').shadowRoot.querySelector('.more-menu [data-act="loop"]').click()`);
  await sleep(50);
  assert(await evaluate(`document.querySelector('video').loop && document.querySelector('fyra-ui-shell').shadowRoot.querySelector('.more-menu [data-act="loop"]').getAttribute('aria-pressed') === 'true'`), 'Mobile loop state is not synchronized');
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(250);
  assert(await evaluate(qualityHidden), 'Resize restored an unavailable quality control');
  await evaluate(`document.querySelector('video').currentTime=document.querySelector('video').duration-0.15`);
  await until(`document.querySelector('video').currentTime < 2 && !document.querySelector('video').paused`, 'Normal player did not loop at end');
  report.cases.qualityAndLoop={emptyHiddenAfterResize:true,mobileState:true,actualLoop:true};
  report.normalScreenshot=await screenshot('normal');

  await evaluate(`window.beforePanorama=window.fyraPlayer;window.fyraPanorama.setEnabled(true)`);
  await until(`window.fyraPlayer !== window.beforePanorama && window.fyraPanorama.getHandle()?.isEnabled() && document.querySelector('video').currentTime > 0.4 && !document.querySelector('video').paused`, 'Native CORS MP4 did not switch to panorama');
  assert(await evaluate(`document.querySelector('video').crossOrigin === 'anonymous' && document.querySelector('video').loop`),'Panorama reload lost CORS or loop state');
  await evaluate(`document.querySelector('.fyra-panoramalite-bar button[data-icon="repeat"]').click();window.fyraPanorama.setEnabled(false)`);
  await sleep(100);
  assert(await evaluate(`!document.querySelector('video').loop && document.querySelector('fyra-ui-shell').shadowRoot.querySelector('.bar [data-act="loop"]').getAttribute('aria-pressed') === 'false'`),'Panorama loop did not synchronize back to normal controls');
  report.cases.nativePanorama={corsReload:true,keepsPlaying:true,sharedLoop:true};

  await evaluate(`document.querySelector('#btn-stop').click()`);
  await load('file',`${base}/no-cors.mp4`);
  await until('window.fyraPlayer?.getState() === "ready"','No-CORS native source not ready');
  await evaluate(`document.querySelector('video').muted=true;document.querySelector('#btn-play').click()`);
  await until(`document.querySelector('video').currentTime > 0.4 && !document.querySelector('video').paused`,'Native no-CORS file failed to play');
  await evaluate(`window.beforeDenied=window.fyraPlayer;window.fyraPanorama.setEnabled(true)`);
  await until(`!document.querySelector('#panorama-feedback').hidden && !document.querySelector('#btn-load').disabled`,'Missing CORS rejection explanation');
  assert(await evaluate(`window.fyraPlayer===window.beforeDenied && !window.fyraPanorama.isEnabled() && !document.querySelector('video').paused && document.querySelector('video').crossOrigin===null`),'CORS refusal broke ordinary playback');
  report.cases.noCorsPanorama={keepsOriginalPlayer:true,keepsPlaying:true,visibleReason:true};

  await evaluate(`document.querySelector('#btn-stop').click()`);
  await load('file',`${base}/cors-probe-wait.mp4`);
  await until('window.fyraPlayer?.getState() === "ready"','Probe cancellation fixture not ready');
  await evaluate(`document.querySelector('video').muted=true;document.querySelector('#btn-play').click()`);
  await until(`document.querySelector('video').currentTime > 0.4 && !document.querySelector('video').paused`,'Probe fixture did not play');
  await evaluate(`window.fyraPanorama.setEnabled(true)`);
  for(let i=0;i<80 && !corsProbeRequests;i++)await sleep(100);
  assert(corsProbeRequests>0 && corsProbeClosed===0,'CORS probe did not remain pending');
  await evaluate(`document.querySelector('#btn-stop').click()`);
  for(let i=0;i<80 && !corsProbeClosed;i++)await sleep(100);
  assert(corsProbeClosed>0,'Stop did not abort the CORS probe');
  assert(await evaluate(`!window.fyraPlayer && !window.fyraPanorama.isEnabled() && !document.querySelector('#btn-load').disabled`),'Probe cancellation revived panorama or locked inputs');
  report.cases.corsProbeCancellation={aborted:true,unlocked:true};

  // Continue the independent panorama geometry checks with a CORS-enabled source.
  await evaluate('document.querySelector("#btn-stop").click();window.fyraPanorama.setEnabled(true)');
  await playFixture();
  await evaluate('document.querySelector("video").loop=true;document.querySelector(".player-shell").dispatchEvent(new Event("pointermove"))');
  await sleep(500);
  report.cases.panoramaWide = await geometry(); verifyGeometry(report.cases.panoramaWide);
  report.wideScreenshot = await screenshot('wide');
  await sleep(3300);
  assert(await evaluate('getComputedStyle(document.querySelector(".fyra-panoramalite-viewer-controls")).opacity === "0"'), 'Playing controls do not hide after inactivity');
  await evaluate('document.querySelector(".player-shell").dispatchEvent(new Event("pointermove"))'); await sleep(350);
  assert(await evaluate('getComputedStyle(document.querySelector(".fyra-panoramalite-viewer-controls")).opacity === "1"'), 'Pointer movement did not restore controls');
  report.cases.autoHide = { hides: true, restores: true };

  await session.send('Runtime.evaluate', { expression: `document.querySelector('.fyra-panoramalite-bar button[data-icon="fullscreen"]').click()`, userGesture: true });
  await until('document.fullscreenElement === document.querySelector(".player-shell")', 'Panorama fullscreen did not open');
  await sleep(350);
  report.cases.fullscreen = await geometry(); verifyGeometry(report.cases.fullscreen);
  await evaluate('document.exitFullscreen()');

  await session.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector(".player-shell").dispatchEvent(new Event("pointermove"))'); await sleep(600);
  report.cases.panoramaCompact = await geometry(); verifyGeometry(report.cases.panoramaCompact);
  report.compactScreenshot = await screenshot('compact');
  // A keyboard-focused volume slider stays visible and does not trigger panorama dragging.
  await evaluate('document.querySelector(".fyra-panoramalite-volume-wrap button").focus()');
  assert(await evaluate('getComputedStyle(document.querySelector(".fyra-panoramalite-volume-pop")).visibility === "visible"'), 'Volume popover is inaccessible by keyboard');
  await evaluate('document.querySelector(".fyra-panoramalite-volume-wrap button").blur();document.querySelector("video").pause()');
  await sleep(3500);
  assert(await evaluate('getComputedStyle(document.querySelector(".fyra-panoramalite-viewer-controls")).opacity === "1"'), 'Paused controls disappeared');
  report.cases.pausedControls = { visible: true, keyboardVolume: true };
  assert(await evaluate('!document.querySelector("#log").textContent.includes("panoramalite error")'), 'Panorama reported texture or rendering errors');
  await evaluate('document.querySelector("#btn-stop").click()');
  await until('document.querySelectorAll(".fyra-panoramalite-viewer-controls").length === 0 && document.querySelectorAll("fyra-ui-shell").length === 0', 'Control plugins were not cleaned up');
  report.passed = true; writeFileSync(`${output}.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure=String(error);
  try {
    report.state=await evaluate(`({state:window.fyraPlayer?.getState(),log:document.querySelector('#log')?.textContent,url:document.querySelector('#input-url')?.value,type:document.querySelector('#type-select')?.value,loadDisabled:document.querySelector('#btn-load')?.disabled})`);
    report.requests={badRequests,hangingRequests,hangingClosed};
  } catch {}
  writeFileSync(`${output}.json`, JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));throw error;
} finally {
  if (session) { await session.send('Browser.close', {}, 3000).catch(() => {}); session.close(); }
  child?.kill();
  server.closeAllConnections(); await new Promise(done => server.close(done));
  if (!profile.startsWith(resolve(tmpdir()) + sep + 'fyra-controls-smoke-')) throw new Error('Unsafe profile path');
  await sleep(1000);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 500 }); }
  catch { console.warn(`Browser profile remains locked: ${profile}`); }
}
