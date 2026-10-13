import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { CdpSession, spawnBrowser, findBrowserExecutable, getDemoPage } from './browser-long-run.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'site-dist');
const fixture = resolve(process.argv[2] ?? join(root, 'examples/testvideo/Rec 0017.mp4'));
assert(existsSync(fixture), 'Pass an existing MP4 fixture path');
// For release acceptance, serve the actual IIFE extracted from the frozen tarball.
const archive=process.env.FYRA_SMOKE_PACKAGE ? resolve(process.env.FYRA_SMOKE_PACKAGE) : null;
const candidate=archive ? execFileSync('tar',['-xOf',archive,'package/dist/fyraplayer.iife.js'],{maxBuffer:16*1024*1024}) : null;
const artifact=archive ? {filename:archive,sha256:createHash('sha256').update(readFileSync(archive)).digest('hex')} : null;
const profile = mkdtempSync(join(tmpdir(), 'fyra-package-smoke-'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if(candidate && url.pathname==='/sdk/fyraplayer.iife.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(candidate);return;}
  const file = url.pathname === '/fixture.mp4' ? fixture : resolve(site, '.' + decodeURIComponent(url.pathname));
  if ((file !== fixture && !file.startsWith(site + sep)) || !existsSync(file)) {
    res.writeHead(404); res.end(); return;
  }
  const data = readFileSync(file);
  const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mp4': 'video/mp4', '.css': 'text/css' }[extname(file)] ?? 'application/octet-stream';
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]); const end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
    if (start > end) { res.writeHead(416); res.end(); return; }
    res.writeHead(206, { 'Content-Type': mime, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    res.end(data.subarray(start, end + 1));
  } else {
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, 'Accept-Ranges': 'bytes' }); res.end(data);
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/minimal-iife.html?file=/fixture.mp4`;
const cdpPort = Number(process.env.FYRA_SMOKE_CDP_PORT ?? 9498);
let session; let child;
try {
  child = spawnBrowser(findBrowserExecutable({ browser: 'edge' }), cdpPort, profile, 'about:blank', { headless: true });
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${cdpPort}/json`)).ok) break; } catch { /* starting */ }
    await sleep(250);
  }
  const page = await getDemoPage(cdpPort, 'about:blank');
  session = new CdpSession(page.webSocketDebuggerUrl);
  await session.send('Page.navigate', { url });
  let before;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const result = await session.send('Runtime.evaluate', { expression: 'JSON.stringify({sdk:!!window.FyraPlayerSDK,ready:!!window.fyraPlayer,width:document.querySelector("video")?.videoWidth,time:document.querySelector("video")?.currentTime})', returnByValue: true });
      before = JSON.parse(result.result.value);
      if (before.sdk && before.ready && before.width > 0 && before.time > 0) break;
    } catch { /* initial navigation */ }
    await sleep(250);
  }
  assert(before?.sdk && before.ready && before.width > 0, 'IIFE page did not load and decode the fixture');
  await sleep(2500);
  const result = await session.send('Runtime.evaluate', {
    expression: '(async()=>{const p=window.fyraPlayer,v=document.querySelector("video");const result={time:v.currentTime,frames:v.getVideoPlaybackQuality().totalVideoFrames,width:v.videoWidth,ui:document.querySelectorAll("fyra-ui-shell").length};await p.destroy();result.uiAfter=document.querySelectorAll("fyra-ui-shell").length;return result})()',
    awaitPromise: true, returnByValue: true
  });
  const after = result.result.value;
  assert(after.time > before.time + 1, 'Video time did not advance');
  assert(after.frames > 0 && after.ui === 1 && after.uiAfter === 0, 'Frame or UI teardown failed');
  const pluginsResult = await session.send('Runtime.evaluate', {
    expression: `(async () => {
      const {FyraPlayer, createFrameClockPlugin, createSnapshotPlugin, mediaTimeToPts90k} = window.FyraPlayerSDK;
      let clock, snapshots; const samples = [], sessions = [];
      const video = document.querySelector('video');
      const p = new FyraPlayer({video, muted:true, sources:[{type:'file',url:'/fixture.mp4'}], plugins:[
        createFrameClockPlugin({fallback:'none',onHandle:h=>{clock=h},onFrame:s=>samples.push(s)}),
        createSnapshotPlugin({onHandle:h=>{snapshots=h}})
      ]});
      p.on('sessionchange', event => sessions.push({epoch:event.epoch,reason:event.reason}));
      try {
        await p.init(); await p.play();
        const deadline = Date.now()+5000;
        while(!clock.getLatest() && Date.now()<deadline) await new Promise(r=>setTimeout(r,50));
        const frame = clock.getLatest();
        const result = await snapshots.capture({maxWidth:320,type:'image/jpeg',quality:0.8});
        const bitmap = await createImageBitmap(result.blob);
        const output = {precision:frame?.precision, mediaTime:frame?.mediaTime, samples:samples.length,
          pts:frame ? String(mediaTimeToPts90k(frame.mediaTime,{mediaTime:0,pts90k:900000n})) : null,
          blobBytes:result.blob.size,width:bitmap.width,height:bitmap.height,
          expectedWidth:Math.min(320,video.videoWidth),
          expectedHeight:Math.max(1,Math.floor(video.videoHeight*Math.min(1,320/video.videoWidth))),
          ui:document.querySelectorAll('fyra-ui-shell').length};
        bitmap.close();
        output.session = p.getPlaybackSession();
        const oldEpoch = output.session.epoch;
        await p.switchSource(0); await p.play();
        const nextDeadline = Date.now()+5000;
        while ((!clock.getLatest() || clock.getLatest().sessionEpoch <= oldEpoch) && Date.now()<nextDeadline) await new Promise(r=>setTimeout(r,50));
        output.sessionAfterSwitch = p.getPlaybackSession();
        output.frameSessionAfterSwitch = clock.getLatest()?.sessionEpoch;
        output.sessionEvents = sessions;
        await p.destroy();
        output.sessionAfterDestroy = p.getPlaybackSession();
        output.clockAfter=clock.getLatest();
        try {await snapshots.capture(); output.captureAfter='unexpected';}catch(e){output.captureAfter=e.name;}
        return output;
      } finally {await p.destroy();}
    })()`,
    awaitPromise: true, returnByValue: true
  });
  if (pluginsResult.exceptionDetails) throw new Error(JSON.stringify(pluginsResult.exceptionDetails));
  const plugins = pluginsResult.result.value;
  assert(plugins.precision === 'video-frame' && plugins.samples > 0, 'No displayed-frame clock samples');
  assert(plugins.blobBytes > 0 && plugins.width === plugins.expectedWidth && plugins.height === plugins.expectedHeight && plugins.ui === 0, 'Snapshot without UI failed');
  assert(plugins.clockAfter === null && plugins.captureAfter === 'AbortError', 'Plugin handles survived teardown');
  assert(plugins.session.status === 'loaded' && plugins.session.source.url === '/fixture.mp4', 'Actual session unavailable');
  assert(plugins.sessionAfterSwitch.epoch > plugins.session.epoch && plugins.frameSessionAfterSwitch === plugins.sessionAfterSwitch.epoch, 'Clock did not follow the new playback session');
  assert(plugins.sessionAfterDestroy === null, 'Playback session survived destroy');
  const output = process.env.FYRA_SMOKE_OUTPUT ?? join(root, '.fyra-long-run/session-plugins-browser.json');
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(resolve(output), JSON.stringify({ checkedAt: new Date().toISOString(), artifact, before, after, plugins }, null, 2));
  console.log(JSON.stringify({ iife: 'passed', ...after, plugins }));
} finally {
  if (session) { await session.send('Browser.close').catch(() => {}); session.close(); }
  child?.kill();
  server.closeAllConnections(); server.close();
  // Only our uniquely-created temporary browser profile may be removed.
  if (!profile.startsWith(resolve(tmpdir()) + sep + 'fyra-package-smoke-')) throw new Error('Unsafe profile path');
  await sleep(1000);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
  catch (error) { console.warn(`Temporary browser profile retained: ${profile}: ${error.message}`); }
}
