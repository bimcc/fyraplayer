import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {CdpSession,spawnBrowser,findBrowserExecutable,getDemoPage} from './browser-long-run.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.env.FYRA_SMOKE_OUTPUT ?? join(root,'.fyra-long-run/playback-health-browser.json'));
const profile=mkdtempSync(join(tmpdir(),'fyra-health-smoke-'));
const video=readFileSync(join(root,'examples/testvideo/Rec 0017.mp4'));
const server=createServer((req,res)=>{
  if(req.url==='/sdk.js'){res.setHeader('Content-Type','application/javascript');res.end(readFileSync(join(root,'dist/fyraplayer.iife.js')));return;}
  if(req.url==='/video.mp4'){res.setHeader('Content-Type','video/mp4');res.end(video);return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><video muted playsinline width="320"></video><script src="/sdk.js"></script>');
});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const port=Number(process.env.FYRA_SMOKE_CDP_PORT ?? 9551);
let session,child;
try{
  child=spawnBrowser(findBrowserExecutable({browser:'edge'}),port,profile,'about:blank',{headless:true});
  for(let i=0;i<80;i++){try{if((await fetch(`http://127.0.0.1:${port}/json`)).ok)break;}catch{}await sleep(250);}
  session=new CdpSession((await getDemoPage(port,'about:blank')).webSocketDebuggerUrl);
  await session.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  for(let i=0;i<80;i++){const r=await session.send('Runtime.evaluate',{expression:'!!window.FyraPlayerSDK',returnByValue:true});if(r.result.value)break;await sleep(250);}
  const result=await session.send('Runtime.evaluate',{expression:`(async()=>{
    const {FyraPlayer,createPlaybackHealthPlugin}=window.FyraPlayerSDK;
    const video=document.querySelector('video');
    const wait=ms=>new Promise(done=>setTimeout(done,ms));
    const until=async(fn,label)=>{const deadline=Date.now()+8000;while(!fn()){if(Date.now()>deadline)throw new Error(label);await wait(30);}};
    const output={};let health;
    const file=new FyraPlayer({video,muted:true,reconnect:{enabled:false},sources:[{type:'file',url:'/video.mp4'}],plugins:[
      createPlaybackHealthPlugin({fallback:'none',stallThresholdMs:600,checkIntervalMs:100,onHandle:h=>{health=h;}})
    ]});
    try{
      await file.init();await file.play();await until(()=>health.snapshot().firstFrameMs!==undefined && video.currentTime>0.4,'No native frame observation');
      output.native=health.snapshot();await file.pause();await wait(900);output.paused=health.snapshot();
      await file.play();await until(()=>video.currentTime>0.7,'Native resume failed');
      await file.stop();output.stopped=health.snapshot();
    }finally{await file.destroy();output.destroyed=health.snapshot();}
    // A controlled captureStream is a real browser video-frame source. No synthetic
    // waiting events or fake frame callbacks are dispatched in this case.
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;
    const ctx=canvas.getContext('2d'),stream=canvas.captureStream(0),track=stream.getVideoTracks()[0];
    let drawTimer,ticks=0;
    const draw=()=>{ctx.fillStyle=ticks++%2?'#1268cf':'#d66020';ctx.fillRect(0,0,320,200);track.requestFrame();};
    const start=()=>{if(!drawTimer){draw();drawTimer=setInterval(draw,50);}};
    const freeze=()=>{clearInterval(drawTimer);drawTimer=undefined;};
    const listeners=new Map();
    const emit=(name,...args)=>{for(const fn of listeners.get(name)??[])fn(...args);};
    const tech={canPlay:s=>s.type==='fixture-frames',async load(_source,opts){video.srcObject=stream;emit('ready');},
      async play(){start();await video.play();emit('play');},async pause(){video.pause();emit('pause');},async seek(){},
      getStats(){return {ts:Date.now()};},on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
      off(name,fn){listeners.get(name)?.delete(fn);},async destroy(){freeze();stream.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;}};
    const events=[],qos=[];
    const synthetic=new FyraPlayer({video,muted:true,reconnect:{enabled:false},sources:[{type:'fixture-frames',url:'fixture://frames'}],plugins:[
      ({techs})=>{const registration=techs.register('fixture-frames',tech);return {destroy:()=>registration.unregister()};},
      createPlaybackHealthPlugin({fallback:'none',stallThresholdMs:600,checkIntervalMs:100,onHandle:h=>{health=h;},onEvent:e=>events.push(e)})
    ]});
    synthetic.on('qos',e=>qos.push(e));
    try{
      await synthetic.init();await synthetic.play();await until(()=>health.snapshot().mediaTime>0.3,'No controlled video frames');
      freeze();await until(()=>health.snapshot().status==='stalled','Frame freeze was not detected');
      output.freeze=health.snapshot();output.freezeVideoPaused=video.paused;
      start();await until(()=>health.snapshot().status==='playing' && !health.snapshot().stall,'Frame recovery was not observed');
      output.recovered=health.snapshot();
      health.setSuspended(true);freeze();await wait(1000);output.suspended=health.snapshot();
      health.setSuspended(false);start();await wait(300);output.afterSuspension=health.snapshot();
      output.events=events;output.qos=qos;
      await synthetic.stop();output.syntheticStop=health.snapshot();output.trackAfterStop=track.readyState;
    }finally{await synthetic.destroy();output.syntheticDestroy=health.snapshot();}
    return output;
  })()`,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  const data=result.result.value;
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(data,null,2));
  assert(data.native.precision==='video-frame' && data.native.firstFrameMs>=0 && data.native.mediaTime>0,'Native first frame lacks real frame evidence');
  // Codec startup may exceed the intentionally short 600ms observation threshold.
  assert(data.paused.status==='paused' && data.paused.stallCount===data.native.stallCount,'User pause was counted as freeze');
  assert(data.stopped.status==='stopped' && data.destroyed.status==='destroyed','Stop/destroy observation lifecycle failed');
  assert(data.freeze.status==='stalled' && data.freeze.stallCount===1 && !data.freezeVideoPaused,'Controlled playing freeze was not recorded');
  assert(data.recovered.status==='playing' && data.recovered.totalStallMs>=600,'Progress did not close the observed stall');
  assert(data.events.some(e=>e.type==='stall-end' && e.endReason==='progress'),'Recovery only used play/ready signals');
  assert(data.suspended.status==='suspended' && data.suspended.stallCount===1 && data.afterSuspension.stallCount===1,'Excluded observation became a false stall');
  assert.deepEqual(data.qos.map(e=>e.code),['PLAYBACK_STALL','PLAYBACK_RECOVERED']);
  assert(data.syntheticStop.status==='stopped' && data.trackAfterStop==='ended' && data.syntheticDestroy.status==='destroyed','Controlled stream resources survived stop');
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({checkedAt:new Date().toISOString(),browser:(await session.send('Browser.getVersion')).product,...data},null,2));
  console.log(JSON.stringify({passed:true,firstFrameMs:data.native.firstFrameMs,precision:data.native.precision,stallMs:data.recovered.totalStallMs,stallReason:data.freeze.stall.reason,trackAfterStop:data.trackAfterStop}));
}finally{
  if(session){await session.send('Browser.close').catch(()=>{});session.close();}
  child?.kill();server.closeAllConnections();server.close();
  if(!profile.startsWith(resolve(tmpdir())+sep+'fyra-health-smoke-'))throw new Error('Unsafe temporary profile path');
  await sleep(1000);try{rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:500});}catch{console.warn('Test browser profile remains locked: '+profile);}
}
