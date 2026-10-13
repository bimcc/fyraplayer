import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { CdpSession, spawnBrowser, findBrowserExecutable, getDemoPage } from './browser-long-run.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(resolve(process.argv[2] ?? join(root, '.fyra-long-run/wt-fixture/ready.json')), 'utf8'));
const fixture = resolve(process.argv[3] ?? join(root, 'examples/testvideo/Rec 0017.mp4'));
assert(existsSync(fixture), 'Pass an existing H.264 MP4 fallback fixture');
const archive=process.env.FYRA_SMOKE_PACKAGE ? resolve(process.env.FYRA_SMOKE_PACKAGE) : null;
const sdk=archive ? execFileSync('tar',['-xOf',archive,'package/dist/fyraplayer.iife.js'],{maxBuffer:16*1024*1024}) : readFileSync(join(root,'dist/fyraplayer.iife.js'));
const artifact=archive ? {filename:archive,sha256:createHash('sha256').update(readFileSync(archive)).digest('hex')} : null;
// Opt in to the separately built fyraklv repository; never add it to SDK dependencies.
let klvBundle;
if (process.env.FYRA_KLV_PROJECT) {
  assert(manifest.metadata, 'Restart the fixture to enable the metadata endpoint');
  const compiled = await build({stdin:{contents:
    `export { createWebTransportKlvIntegration } from ${JSON.stringify(join(root,'examples/integrations/webtransport-klv.ts'))};
     export { KLVStreamManager } from ${JSON.stringify(join(resolve(process.env.FYRA_KLV_PROJECT),'dist/index.js'))};`,
    resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'FyraKlvFixture',platform:'browser'});
  klvBundle=compiled.outputFiles[0].contents;
}
const profile = mkdtempSync(join(tmpdir(), 'fyra-webtransport-smoke-'));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const server = createServer((req, res) => {
  if (req.url === '/sdk.js') {res.setHeader('Content-Type', 'application/javascript');res.end(sdk);return;}
  if (req.url === '/fixture.mp4') {res.setHeader('Content-Type', 'video/mp4');res.end(readFileSync(fixture));return;}
  if (req.url === '/klv-fixture.js' && klvBundle) {res.setHeader('Content-Type','application/javascript');res.end(klvBundle);return;}
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><meta charset="utf-8"><video id="player" muted playsinline width="320"></video><script src="/sdk.js"></script>'+(klvBundle?'<script src="/klv-fixture.js"></script>':''));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;
const cdpPort = Number(process.env.FYRA_SMOKE_CDP_PORT ?? 9533);
const stress = process.env.FYRA_WT_STRESS === '1';
let session; let child;
try {
  child=spawnBrowser(findBrowserExecutable({browser:'edge'}),cdpPort,profile,'about:blank',{headless:true});
  for(let attempt=0;attempt<80;attempt++) {
    try {if((await fetch(`http://127.0.0.1:${cdpPort}/json`)).ok) break;}catch{/* browser starting */}
    await sleep(250);
  }
  const page=await getDemoPage(cdpPort,'about:blank');
  session=new CdpSession(page.webSocketDebuggerUrl);
  await session.send('Page.navigate',{url});
  for(let attempt=0;attempt<80;attempt++) {
    const result=await session.send('Runtime.evaluate',{expression:'!!window.FyraPlayerSDK',returnByValue:true});
    if(result.result.value) break;
    await sleep(250);
  }
  const result=await session.send('Runtime.evaluate',{
    expression:`(async()=>{
      const manifest=${JSON.stringify(manifest)};
      const {FyraPlayer,createWebTransportTechPlugin}=window.FyraPlayerSDK;
      if(!WebTransport || !VideoDecoder) throw new Error('Native WebTransport/WebCodecs unavailable');
      const video=document.querySelector('video');
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const bounded=(work,label)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(label)),20000);work.then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});
      window.wtSmokeStage='h264';
      const until=async(fn,label)=>{const end=Date.now()+8000;while(!fn()){if(Date.now()>end)throw new Error(label);await wait(30);}};
      const hashes=[{algorithm:'sha-256',value:Uint8Array.from(manifest.hash)}];
      const make=(path,opts={},fallbacks)=>{
        const frames=[],events=[],errors=[],metadata=[];
        const p=new FyraPlayer({video,muted:true,loadTimeoutMs:16000,reconnect:{enabled:false},sources:[{
          type:'webtransport',url:manifest.url.replace('/video',path),allowH265:path==='/hevc',fallbacks
        }],plugins:[createWebTransportTechPlugin({serverCertificateHashes:hashes,startupTimeoutMs:15000,onFrame:(_frame,info)=>{frames.push(info);},...opts})]});
        p.on('network',e=>events.push({type:e.type,codec:e.codec,protocol:e.protocol}));
        p.on('error',e=>errors.push({name:e?.name,message:e?.message}));
        p.on('metadata',e=>metadata.push({timestampUs:e.timestampUs,bytes:e.raw.byteLength}));
        return {p,frames,events,errors,metadata};
      };
      const h264=make('/video');
      let output={};
      try{
        window.wtSmokeStage='h264-init';await bounded(h264.p.init(),'H264 init timeout');
        if(h264.p.getPlaybackSession()?.status!=='loaded')throw new Error('H264 startup failed: '+JSON.stringify(h264.errors));
        window.wtSmokeStage='h264-play';await bounded(h264.p.play(),'H264 play timeout');
        window.wtSmokeStage='h264-frames';
        await until(()=>h264.frames.length>=10 && video.videoWidth===320,'No native decoded/presented frames');
        const tracks=video.srcObject.getTracks();
        const before=h264.frames.length;
        await h264.p.pause();await wait(300);const paused=h264.frames.length;
        window.wtSmokeStage='h264-resume';await bounded(h264.p.play(),'H264 resume timeout');await until(()=>h264.frames.length>paused+3,'No keyframe recovery after pause');
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
        const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0);const pixels=ctx.getImageData(0,0,320,200).data;
        let brightness=0;for(let i=0;i<pixels.length;i+=4)brightness+=pixels[i]+pixels[i+1]+pixels[i+2];
        output.h264={session:h264.p.getPlaybackSession(),first:h264.frames[0],last:h264.frames.at(-1),frames:h264.frames.length,beforePause:before,paused,
          width:video.videoWidth,height:video.videoHeight,captureTime:video.currentTime,brightness,events:h264.events};
        await h264.p.stop();output.h264.srcAfterStop=video.srcObject;output.h264.tracksAfter=tracks.map(t=>t.readyState);
      }finally{await bounded(h264.p.destroy(),'H264 destroy timeout');}
      window.wtSmokeStage='metadata-without-klv';
      const raw=make(manifest.metadata.path);
      try {
        await bounded(raw.p.init(),'Raw metadata video init timeout');
        if(raw.p.getPlaybackSession()?.status!=='loaded')throw new Error('Raw metadata video startup failed: '+JSON.stringify(raw.errors));
        await raw.p.play();
        await until(()=>raw.frames.length>=8 && raw.metadata.length>=8 && video.videoWidth===320,'Metadata without KLV prevented video playback');
        const tracks=video.srcObject.getTracks();
        output.rawMetadata={frames:raw.frames.length,metadata:raw.metadata.length,firstFrame:raw.frames[0],firstMetadata:raw.metadata[0],errors:raw.errors,source:raw.p.getCurrentSource()};
        await raw.p.stop();output.rawMetadata.srcAfterStop=video.srcObject;output.rawMetadata.tracksAfter=tracks.map(t=>t.readyState);
      }finally{await bounded(raw.p.destroy(),'Raw metadata destroy timeout');}
      window.wtSmokeStage='cancel';
      const pending=make('/hang');
      try{
        const init=pending.p.init();
        await until(()=>pending.events.some(e=>e.type==='wt-open'),'Hang fixture did not connect');
        const start=performance.now();await pending.p.stop();await init;
        output.cancel={ms:performance.now()-start,state:pending.p.getState(),src:video.srcObject,frames:pending.frames.length};
      }finally{await pending.p.destroy();}
      window.wtSmokeStage='fallback';
      const fallback=make('/bad-config',{},[{type:'file',url:'/fixture.mp4'}]);
      try{
        await fallback.p.init();await fallback.p.play();
        await until(()=>video.videoWidth>0 && video.currentTime>0,'No explicit fallback video');
        output.fallback={session:fallback.p.getPlaybackSession(),width:video.videoWidth,frames:fallback.frames.length};
      }finally{await fallback.p.destroy();}
      window.wtSmokeOutput=output;
      window.wtSmokeStage='hevc';
      if(manifest.hevc){
        const configSupport=await VideoDecoder.isConfigSupported(manifest.hevc);
        output.hevc={config:manifest.hevc,supported:configSupport.supported};
        if(configSupport.supported){
          const hevc=make('/hevc');
          try{await bounded(hevc.p.init(),'HEVC init timeout');if(hevc.p.getPlaybackSession()?.status!=='loaded')throw new Error('HEVC startup failed');await bounded(hevc.p.play(),'HEVC play timeout');await until(()=>hevc.frames.length>=8 && video.videoWidth===320,'HEVC decode failed');
            output.hevc.decodeStatus='passed';
          }catch(error){output.hevc.decodeStatus='failed';output.hevc.failure=error.message;}
          finally{
            Object.assign(output.hevc,{frames:hevc.frames.length,session:hevc.p.getPlaybackSession(),first:hevc.frames[0],width:video.videoWidth,state:hevc.p.getState(),errors:hevc.errors,events:hevc.events});
            await bounded(hevc.p.destroy(),'HEVC destroy timeout');
          }
        }
      }
      return output;
    })()`,awaitPromise:true,returnByValue:true
  });
  if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  const data=result.result.value;
  assert(data.h264.session.tech==='webtransport' && data.h264.frames>=10 && data.h264.brightness>0,'Native HTTP/3 + decode + presentation failed');
  assert(!('protocol' in data.h264.session.source) && data.h264.events.some(e=>e.type==='wt-open' && e.protocol==='fyra-media'),'Single media format was not used');
  assert(data.rawMetadata.frames>=8 && data.rawMetadata.metadata>=8 && data.rawMetadata.errors.length===0,'Optional metadata requires a KLV plugin');
  assert(data.rawMetadata.firstFrame.timestamp===manifest.metadata.firstTimestamp && data.rawMetadata.firstMetadata.timestampUs===manifest.metadata.firstTimestamp,'Raw metadata lost the shared original clock');
  assert(data.rawMetadata.srcAfterStop===null && data.rawMetadata.tracksAfter.every(t=>t==='ended'),'Raw metadata stream retains capture tracks after stop');
  assert(data.h264.first.timestamp===5000000 && data.h264.last.timestamp>data.h264.first.timestamp,'Original PTS clock did not advance');
  assert(data.h264.paused===data.h264.beforePause,'Paused transport continued presenting video');
  assert(data.h264.srcAfterStop===null && data.h264.tracksAfter.every(value=>value==='ended'),'Capture tracks survived stop');
  assert(data.cancel.ms<1500 && data.cancel.frames===0 && data.cancel.src===null,'Pending first frame could not be cancelled');
  assert(data.fallback.session.tech==='file' && data.fallback.session.source.url==='/fixture.mp4' && data.fallback.width>0,'Explicit alternate Source failed');
  if (klvBundle) {
    const metadataResult=await session.send('Runtime.evaluate',{expression:`(async()=>{
      const manifest=${JSON.stringify(manifest)};
      const {KLVStreamManager,createWebTransportKlvIntegration}=window.FyraKlvFixture;
      const video=document.querySelector('video'),service=new KLVStreamManager();
      const frames=[],metadata=[],resets=[],errors=[];
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const until=async(fn,label)=>{const end=Date.now()+8000;while(!fn()){if(Date.now()>end)throw new Error(label);await wait(20);}};
      const buffer=()=>{const b=service.getBufferInfo();return {count:b.count,firstPts:b.firstPts?.toString()??null,lastPts:b.lastPts?.toString()??null};};
      const integration=createWebTransportKlvIntegration({createService:()=>service,onError:error=>errors.push(error.message),transport:{
        serverCertificateHashes:[{algorithm:'sha-256',value:Uint8Array.from(manifest.hash)}],
        onFrame:(_frame,info)=>{const state=integration.getState();frames.push({...info,state:state?{timestamp:state.timestamp,latitude:state.latitude,longitude:state.longitude}:null});}
      }});
      const p=new window.FyraPlayerSDK.FyraPlayer({video,muted:true,reconnect:{enabled:false},sources:[{
        type:'webtransport',url:manifest.url.replace('/video',manifest.metadata.path)
      }],plugins:integration.plugins});
      p.on('error',error=>errors.push(error.message));
      p.on('metadata',e=>metadata.push({timestampUs:e.timestampUs,pts:e.pts,hasPts90k:'pts90k' in e,pid:e.pid,bytes:e.raw.byteLength}));
      p.on('sessionchange',e=>{if(e.reason==='discontinuity')resets.push({epoch:e.epoch,state:integration.getState(),buffer:buffer()});});
      try {
        await p.init();if(p.getPlaybackSession()?.status!=='loaded')throw new Error('Metadata startup failed: '+JSON.stringify(errors));
        await p.play();await until(()=>frames.length>=8,'No metadata video frames');
        const beforePause=frames.length;await p.pause();await wait(250);const paused=frames.length;
        await p.play();await until(()=>resets.length===1 && frames.filter(f=>f.timelineId!==frames[0].timelineId).length>=6,'No video/KLV recovery after timestamp restart');
        const output={frames,metadata,resets,errors,beforePause,paused,session:p.getPlaybackSession(),buffer:buffer(),captureTime:video.currentTime};
        const tracks=video.srcObject.getTracks();await p.stop();
        output.afterStop={state:integration.getState(),buffer:buffer(),session:p.getPlaybackSession(),src:video.srcObject,tracks:tracks.map(t=>t.readyState)};
        return output;
      }finally{await p.destroy();}
    })()`,awaitPromise:true,returnByValue:true});
    if(metadataResult.exceptionDetails) throw new Error(JSON.stringify(metadataResult.exceptionDetails));
    data.metadata=metadataResult.result.value;
    const media=data.metadata;
    assert.equal(media.errors.length,0,'Metadata decoder or KLV parser failed');
    assert(media.frames.length>=14 && media.frames.every(f=>f.state && f.state.timestamp===Number((BigInt(f.timestamp)*9n+50n)/100n)
      && Math.abs(f.state.latitude-Math.floor(f.timestamp/50000)*100000*90/2147483647)<1e-9 && f.state.longitude===0),'Actual fyraklv queries do not match the original frame clock and changing telemetry marker');
    assert(media.metadata.every(e=>!e.hasPts90k && e.pid===300 && e.bytes>16),'Transport metadata incorrectly claims TS PTS or loses KLV payload');
    assert(media.frames[0].timestamp===manifest.metadata.firstTimestamp && media.frames.some(f=>f.timestamp===manifest.metadata.resetTimestamp),'Original microsecond timestamps lost across config reset');
    assert(media.resets.length===1 && media.resets[0].state===null && media.resets[0].buffer.count===0,'Config reset retains obsolete telemetry/clock');
    assert.equal(media.beforePause,media.paused,'Metadata stream pause continues drawing frames');
    assert(media.afterStop.state===null && media.afterStop.buffer.count===0 && media.afterStop.session===null && media.afterStop.src===null && media.afterStop.tracks.every(t=>t==='ended'),'Metadata stream stop retains telemetry or video resources');
  }
  if (stress) {
    const stressResult=await session.send('Runtime.evaluate',{expression:`(async()=>{
      const manifest=${JSON.stringify(manifest)};
      const {FyraPlayer,createWebTransportTechPlugin}=window.FyraPlayerSDK;
      const hevcSupported=!!manifest.hevc && (await VideoDecoder.isConfigSupported(manifest.hevc)).supported;
      const hashes=[{algorithm:'sha-256',value:Uint8Array.from(manifest.hash)}];
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      const group=async(paths,maxDecodeQueue)=>{
        const rows=paths.map(path=>{
          const video=document.createElement('video');video.muted=true;video.playsInline=true;video.width=320;document.body.append(video);
          const row={path,video,frames:[],events:[],errors:[],firstFrameMs:null,tracks:[],startedAt:performance.now()};
          row.player=new FyraPlayer({video,muted:true,reconnect:{enabled:false},sources:[{
            type:'webtransport',url:manifest.url.replace('/video',path),allowH265:path.startsWith('/hevc')
          }],plugins:[createWebTransportTechPlugin({serverCertificateHashes:hashes,maxDecodeQueue,onFrame:(_frame,info)=>{
            if(row.firstFrameMs===null)row.firstFrameMs=performance.now()-row.startedAt;row.frames.push(info);
          }})]});
          row.player.on('network',e=>row.events.push({type:e.type,reason:e.reason,dropped:e.dropped}));
          row.player.on('error',e=>row.errors.push(e.message));return row;
        });
        let samples;
        try {
          await Promise.all(rows.map(async row=>{
            await row.player.init();
            if(row.player.getPlaybackSession()?.status==='loaded')await row.player.play();
          }));
          const deadline=Date.now()+6000;
          while(rows.some(row=>row.frames.length<8 || !row.video.videoWidth) && Date.now()<deadline)await wait(30);
          samples=rows.map(row=>{
            row.tracks=row.video.srcObject?.getTracks()??[];
            return {path:row.path,frames:row.frames.length,first:row.frames[0],last:row.frames.at(-1),firstFrameMs:row.firstFrameMs,
              width:row.video.videoWidth,session:row.player.getPlaybackSession(),events:row.events,errors:row.errors};
          });
          await Promise.all(rows.map(row=>row.player.stop()));
          const framesAtStop=rows.map(row=>row.frames.length);await wait(120);
          samples.forEach((sample,index)=>Object.assign(sample,{srcAfterStop:rows[index].video.srcObject,
            tracksAfter:rows[index].tracks.map(track=>track.readyState),lateFrames:rows[index].frames.length-framesAtStop[index]}));
        }finally{await Promise.all(rows.map(row=>row.player.destroy()));rows.forEach(row=>row.video.remove());}
        return samples;
      };
      // Small queues and 40 unpaced frames stress warmup without disabling real WebCodecs.
      const burst=await group(hevcSupported?['/burst','/hevc-burst']:['/burst'],2);
      const concurrent=await group(hevcSupported?['/video','/video','/hevc','/hevc']:Array(4).fill('/video'),8);
      return {hevcSupported,scope:'Loopback 320x200 20fps, burst plus four concurrent sessions; not a capacity benchmark',burst,concurrent};
    })()`,awaitPromise:true,returnByValue:true},55000);
    if(stressResult.exceptionDetails)throw new Error(JSON.stringify(stressResult.exceptionDetails));
    data.stress=stressResult.result.value;
  }
  const output=resolve(process.env.FYRA_SMOKE_OUTPUT ?? join(root,'.fyra-long-run/webtransport-browser.json'));
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify({checkedAt:new Date().toISOString(),artifact,browser:(await session.send('Browser.getVersion')).product,...data},null,2));
  console.log(JSON.stringify(data));
  // Persist failed conditional decode evidence before making the optional stress gate fail.
  if(stress){
    for(const row of [...data.stress.burst,...data.stress.concurrent]){
      assert(row.session?.status==='loaded' && row.frames>=8 && row.width===320 && row.errors.length===0,'Stress playback failed: '+JSON.stringify(row));
      assert(row.first.timestamp===5000000 && row.last.timestamp>row.first.timestamp,'Decoder warmup lost the original first keyframe');
      assert(row.srcAfterStop===null && row.tracksAfter.length>0 && row.tracksAfter.every(t=>t==='ended') && row.lateFrames===0,'Concurrent stop leaked video resources');
    }
    if(data.hevc?.supported)assert.equal(data.hevc.decodeStatus,'passed','HEVC basic playback failed during stress validation');
  }
}finally{
  if(session){await session.send('Browser.close').catch(()=>{});session.close();}
  child?.kill();server.closeAllConnections();server.close();
  if(!profile.startsWith(resolve(tmpdir())+sep+'fyra-webtransport-smoke-')) throw new Error('Unsafe profile path');
  await sleep(1000);
  try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:500});}
  catch(error){console.warn('Temporary browser profile retained: '+profile+': '+error.message);}
}
