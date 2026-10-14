import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir, cpus, totalmem, platform, release} from 'node:os';
import {resolve, dirname, join, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CdpSession, spawnBrowser, findBrowserExecutable, getDemoPage} from './browser-long-run.mjs';
import {createLiveFixture} from './fixtures/live-media.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const mode=process.argv[2]??'soak';
assert(['soak','recovery'].includes(mode),'Use soak or recovery');
const duration=Number(process.env.FYRA_LIVE_DURATION_SEC??1800)*1000;
assert(Number.isFinite(duration)&&duration>=10000,'Duration must be at least 10 seconds');
const parent=join(root,'.fyra-long-run');mkdirSync(parent,{recursive:true});
const output=mkdtempSync(join(parent,'live-'+mode+'-'));
const archive=process.env.FYRA_SMOKE_PACKAGE&&resolve(process.env.FYRA_SMOKE_PACKAGE);
const sdk=archive?execFileSync('tar',['-xOf',archive,'package/dist/fyraplayer.iife.js'],{maxBuffer:16*1024*1024}):readFileSync(join(root,'dist/fyraplayer.iife.js'));
const artifact={filename:archive??'dist/fyraplayer.iife.js',sha256:createHash('sha256').update(archive?readFileSync(archive):sdk).digest('hex')};
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
let fixture,info,server,session,child,profile,offline=false,hlsRequests=0,hangRequests=0;
const report={mode,startedAt:new Date().toISOString(),artifact,host:{platform:platform(),release:release(),cpu:cpus()[0]?.model,logicalCpus:cpus().length,totalMemory:totalmem()},cases:{},samples:[],
  limits:'Loopback H.264 1280x800/25fps repeated sample; no independent cameras, TURN, speaker listening, GPU/whole-process CPU or mobile-device certification.'};
const save=()=>writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
async function evaluate(expression){const r=await session.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},60000);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function until(expression,label,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await sleep(200);}throw Error(label);}
async function framesSince(before,count=20){await until(`window.tiles.every((t,i)=>t.frames>${JSON.stringify(before)}[i]+${count}&&!t.video.paused&&t.video.readyState>=2)`,'Frames did not recover');}
async function frameCounts(){return evaluate('window.tiles.map(t=>t.frames)');}
async function sample(){const snap=await evaluate('window.snapshot()');const metrics=await session.send('Performance.getMetrics');const m=Object.fromEntries(metrics.metrics.map(x=>[x.name,x.value]));return {at:new Date().toISOString(),...snap,browserMetrics:{jsHeapUsed:m.JSHeapUsedSize,mainThreadTaskSeconds:m.TaskDuration}};}
try{
  if(mode==='recovery'){
    fixture=await createLiveFixture({ports:{rtsp:28664,hls:28998,webrtc:28999,ice:28299,api:29897}});info=fixture;
  }else{
    assert(process.argv[3],'Pass a live-media ready.json for soak');info=JSON.parse(readFileSync(resolve(process.argv[3]),'utf8'));
  }
  report.fixture={output:info.output,media:info.media,sources:info.sources,mediamtxVersion:info.mediamtxVersion};
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/sdk.js'){res.setHeader('Content-Type','application/javascript');res.end(sdk);return;}
    if(url.pathname==='/hang.m3u8'){hangRequests++;return;}
    if(url.pathname.startsWith('/hls/')){
      hlsRequests++;
      if(offline){res.writeHead(503);res.end('injected outage');return;}
      const controller=new AbortController();res.on('close',()=>controller.abort());
      try{
        const upstream=await fetch(`http://127.0.0.1:${info.ports.hls}${url.pathname}${url.search}`,{signal:controller.signal});
        res.writeHead(upstream.status,{'Content-Type':upstream.headers.get('Content-Type')??'application/octet-stream','Cache-Control':'no-store'});
        res.end(Buffer.from(await upstream.arrayBuffer()));
      }catch{if(!res.destroyed){res.writeHead(502);res.end();}}return;
    }
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><title>FyraPlayer live acceptance</title><style>body{margin:0;display:grid;grid-template-columns:1fr 1fr}video{width:640px;height:400px}</style><script src="/sdk.js"></script>');
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const base=`http://127.0.0.1:${server.address().port}`;
  const sources=[{...info.sources.hls,url:base+'/hls/index.m3u8'},info.sources.webrtc,{type:'hls',url:base+'/hang.m3u8'}];
  profile=mkdtempSync(join(tmpdir(),'fyra-live-acceptance-'));
  const port=Number(process.env.FYRA_SMOKE_CDP_PORT??(mode==='soak'?9603:9604));
  child=spawnBrowser(findBrowserExecutable({browser:'edge'}),port,profile,'about:blank',{headless:true});
  for(let n=0;n<100;n++){try{if((await fetch(`http://127.0.0.1:${port}/json`)).ok)break;}catch{}await sleep(250);}
  session=new CdpSession((await getDemoPage(port,'about:blank')).webSocketDebuggerUrl);
  await session.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await session.send('Page.navigate',{url:base});await until('!!window.FyraPlayerSDK','SDK did not load');
  await session.send('Performance.enable');report.browser=(await session.send('Browser.getVersion')).product;
  await evaluate(`(()=>{
    const {FyraPlayer,createDiagnosticsPlugin,createPlaybackHealthPlugin}=FyraPlayerSDK;
    window.tiles=[];window.events=[];window.eventCounts={};window.failureEvents=0;window.active=true;window.sources=${JSON.stringify(sources)};
    window.createTile=async()=>{
      const video=document.createElement('video');video.muted=true;video.playsInline=true;document.body.append(video);
      const t={video,frames:0,lastFrameAt:null};tiles.push(t);
      const onFrame=()=>{t.frames++;t.lastFrameAt=performance.now();if(window.active)t.callback=video.requestVideoFrameCallback(onFrame);};
      t.callback=video.requestVideoFrameCallback(onFrame);
      t.player=new FyraPlayer({video,sources:window.sources,autoplay:true,loadTimeoutMs:12000,
        reconnect:{enabled:true,maxRetries:12,baseDelayMs:500,maxDelayMs:2000,jitter:0,timeoutMs:8000},
        plugins:[createDiagnosticsPlugin({onHandle:h=>t.diagnostics=h}),createPlaybackHealthPlugin({onHandle:h=>t.health=h})]});
      for(const name of ['network','error','sessionchange'])t.player.on(name,event=>{
        if(name==='error'||(name==='network'&&(event?.fatal||event?.severity==='fatal')))window.failureEvents++;
        const key=name+':'+(event?.code??event?.reason??event?.type??'unknown');eventCounts[key]=(eventCounts[key]??0)+1;
        window.events.push({at:performance.now(),tile:tiles.indexOf(t),name,payload:event instanceof Error?{message:event.message}:event});if(events.length>1000)events.shift();
      });
      await t.player.init();
    };
    window.snapshot=()=>({tiles:tiles.map(t=>({state:t.player.getState(),time:t.video.currentTime,ready:t.video.readyState,paused:t.video.paused,width:t.video.videoWidth,height:t.video.videoHeight,frames:t.frames,
      lastFrameAgeMs:t.lastFrameAt===null?null:performance.now()-t.lastFrameAt,quality:{totalFrames:t.video.getVideoPlaybackQuality().totalVideoFrames,droppedFrames:t.video.getVideoPlaybackQuality().droppedVideoFrames},diagnostics:t.diagnostics.snapshot(),health:t.health.snapshot()})),eventCounts:{...eventCounts},failureEvents:window.failureEvents,domVideos:document.querySelectorAll('video').length});
  })()`);
  // Select nonzero sources through the public switchSource API.
  const indices=mode==='soak'?[0,1,0,1]:[0];
  for(const index of indices){await evaluate(`window.createTile(0)`);if(index)await evaluate(`tiles[tiles.length-1].player.switchSource(${index})`);}
  await framesSince(indices.map(()=>0));
  report.initial=await sample();save();console.log('Live '+mode+' started: '+output);
  if(mode==='soak'){
    const end=Date.now()+duration,started=Date.now();let previous=await frameCounts();
    while(Date.now()<end){
      await sleep(Math.min(10000,end-Date.now()));const s=await sample();s.elapsedSec=(Date.now()-started)/1000;report.samples.push(s);save();
      assert(s.tiles.every((t,i)=>t.frames>previous[i]&&!t.paused&&t.ready>=2&&t.lastFrameAgeMs<5000),'A live tile stopped presenting frames');
      assert.equal(s.domVideos,4,'Video elements leaked');previous=s.tiles.map(t=>t.frames);
    }
    const last=report.samples.at(-1),first=report.initial;
    assert.equal(last.failureEvents,0,'Uninjected playback emitted fatal/error events');
    assert(last.tiles.filter((_,i)=>indices[i]===1).every(t=>t.diagnostics.latestStats?.audioPacketsReceived>20),'No WebRTC audio RTP evidence');
    report.cases.soak={seconds:(Date.now()-started)/1000,frameDeltas:last.tiles.map((t,i)=>t.frames-first.tiles[i].frames),heapGrowthBytes:last.browserMetrics.jsHeapUsed-first.browserMetrics.jsHeapUsed,
      mainThreadTaskSeconds:last.browserMetrics.mainThreadTaskSeconds-first.browserMetrics.mainThreadTaskSeconds,
      droppedFrameRatios:last.tiles.map((t,i)=>(t.quality.droppedFrames-first.tiles[i].quality.droppedFrames)/Math.max(1,t.quality.totalFrames-first.tiles[i].quality.totalFrames))};
    assert(report.cases.soak.droppedFrameRatios.every(r=>r<=0.2),'A tile dropped more than 20% of frames');
    assert(report.cases.soak.heapGrowthBytes<128*1024*1024,'JS heap grew by more than 128 MiB');
  }else{
    const one='tiles[0].player';
    async function recovered(name,action){const start=Date.now();await action();const before=await frameCounts();await framesSince(before);report.cases[name]={recoveryMs:Date.now()-start,snapshot:await sample()};save();}
    offline=true;await sleep(18000);report.cases.hlsOutage={durationMs:18000,snapshot:await sample()};
    await recovered('hlsRestore',async()=>{offline=false;});
    await recovered('switchToWebrtc',()=>evaluate(`${one}.switchSource(1)`));
    await until('tiles[0].diagnostics.snapshot().latestStats?.audioPacketsReceived>20','No Opus RTP received');
    await fixture.stopPublisher('rtc');await sleep(8000);
    await recovered('publisherRestart',()=>fixture.startPublisher('rtc',true));
    await fixture.stopPublisher('rtc');await fixture.stopPublisher('hls');await fixture.stopServer();await sleep(5000);
    await recovered('serverRestart',async()=>{await fixture.startServer();await fixture.startPublisher('hls');await fixture.startPublisher('rtc',true);});
    await evaluate(`void ${one}.switchSource(2)`);
    const untilRequest=Date.now()+10000;while(!hangRequests&&Date.now()<untilRequest)await sleep(100);
    assert(hangRequests>0,'Hanging URL was never requested');const stopAt=Date.now();await evaluate(`${one}.stop()`);
    assert(Date.now()-stopAt<2000,'Stop could not cancel pending HTTP');
    report.cases.cancelHang={stopMs:Date.now()-stopAt,requests:hangRequests};
    await recovered('validAfterCancel',()=>evaluate(`${one}.switchSource(0)`));
    const cycles=[];
    for(let n=0;n<8;n++){
      await evaluate(`window.oldTracks=tiles[0].video.srcObject?.getTracks()??[];${one}.stop()`);
      assert(await evaluate(`tiles[0].video.srcObject===null&&!tiles[0].video.getAttribute('src')&&oldTracks.every(t=>t.readyState==='ended')`),'Stop retained tracks or source');
      const start=Date.now();await evaluate(`${one}.switchSource(${n%2})`);await framesSince(await frameCounts());cycles.push({index:n,type:sources[n%2].type,ms:Date.now()-start});
    }
    report.cases.switchStopCycles=cycles;
  }
  report.final=await sample();report.events=await evaluate('window.events');report.hlsRequests=hlsRequests;
  await evaluate(`(async()=>{window.active=false;window.closedTracks=tiles.flatMap(t=>t.video.srcObject?.getTracks()??[]);for(const t of tiles){await t.player.destroy();t.video.cancelVideoFrameCallback(t.callback);}})()`);
  assert(await evaluate(`tiles.every(t=>t.video.srcObject===null&&!t.video.getAttribute('src'))&&closedTracks.every(t=>t.readyState==='ended')`),'Destroy retained media resources');
  report.cleanup={mediaReleased:true};report.passed=true;
}catch(error){report.failure=String(error);if(session)try{report.failureSnapshot=await sample();report.events=await evaluate('window.events');}catch{}process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({output,passed:report.passed,failure:report.failure,cases:report.cases.soak??Object.keys(report.cases)},null,2));
  if(session){await session.send('Browser.close',{},3000).catch(()=>{});session.close();}child?.kill();
  server?.closeAllConnections();server?.close();await fixture?.close();
  if(profile){if(!profile.startsWith(resolve(tmpdir())+sep+'fyra-live-acceptance-'))throw Error('Unsafe profile path');await sleep(1000);try{rmSync(profile,{recursive:true,force:true,maxRetries:2,retryDelay:500});}catch{console.warn('Locked browser profile retained: '+profile);}}
}
