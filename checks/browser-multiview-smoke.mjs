import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {resolve, dirname, join, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {CdpSession, spawnBrowser, findBrowserExecutable, getDemoPage} from './browser-long-run.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),site=join(root,'site-dist');
const output=resolve(process.env.FYRA_MULTIVIEW_OUTPUT ?? join(root,'.fyra-long-run/multiview-browser'));
mkdirSync(dirname(output),{recursive:true});
const fixture=readFileSync(join(root,'examples/testvideo/Rec 0017.mp4'));
const hlsDirectory=process.env.FYRA_MULTIVIEW_HLS_DIR ? resolve(process.env.FYRA_MULTIVIEW_HLS_DIR) : undefined;
let denied=0;
const server=createServer((req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/bad.m3u8'){denied++;res.writeHead(403);res.end();return;}
  if(path.startsWith('/hls/') && hlsDirectory){
    const file=resolve(hlsDirectory,decodeURIComponent(path.slice(5)));
    if(!file.startsWith(hlsDirectory+sep)||!existsSync(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t');res.end(readFileSync(file));return;
  }
  const file=resolve(site,'.'+decodeURIComponent(path));
  if(path!=='/fixture.mp4' && (!file.startsWith(site+sep)||!existsSync(file))){res.writeHead(404);res.end();return;}
  const data=path==='/fixture.mp4'?fixture:readFileSync(file);
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.mp4':'video/mp4'}[extname(path)] ?? 'application/octet-stream';
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
  if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):data.length-1,data.length-1);
    if(start>end){res.writeHead(416);res.end();return;}
    res.writeHead(206,{'Content-Type':mime,'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});res.end(data.subarray(start,end+1));
  }else{res.writeHead(200,{'Content-Type':mime,'Content-Length':data.length});res.end(data);}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`,url=process.env.FYRA_MULTIVIEW_URL ?? `${base}/multiview.html`;
const profile=mkdtempSync(join(tmpdir(),'fyra-multiview-smoke-')),port=Number(process.env.FYRA_MULTIVIEW_CDP_PORT??9561);
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const report={url,checkedAt:new Date().toISOString(),cases:{}};
let session,child;
const app='window.fyraMultiView',coord=`${app}.coordinator`;
async function evaluate(expression){const r=await session.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},45000);if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function until(expression,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(expression))return;await sleep(100);}throw new Error(label);}
async function key(code,key,virtualKey){await session.send('Input.dispatchKeyEvent',{type:'keyDown',code,key,windowsVirtualKeyCode:virtualKey});await session.send('Input.dispatchKeyEvent',{type:'keyUp',code,key,windowsVirtualKeyCode:virtualKey});}
async function screenshot(name){const result=await session.send('Page.captureScreenshot',{format:'png'});const file=`${output}-${name}.png`;writeFileSync(file,Buffer.from(result.data,'base64'));return file;}
try{
  child=spawnBrowser(findBrowserExecutable({browser:'edge'}),port,profile,'about:blank',{headless:true});
  for(let n=0;n<80;n++){try{if((await fetch(`http://127.0.0.1:${port}/json`)).ok)break;}catch{}await sleep(250);}
  session=new CdpSession((await getDemoPage(port,'about:blank')).webSocketDebuggerUrl);
  await session.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1200,deviceScaleFactor:1,mobile:false});
  await session.send('Page.navigate',{url});await until(`!!${app}`,'Multiview did not load');
  report.browser=(await session.send('Browser.getVersion')).product;
  await evaluate(`(()=>{for(const t of ${app}.tiles.values())t.input.value=${JSON.stringify(`${base}/fixture.mp4`)};window.states=[];window.watch=setInterval(()=>window.states.push(${coord}.snapshot()),25);document.querySelector('#start-all').click();})()`);
  await until(`${coord}.snapshot().tiles.every(t=>t.state==='active') && [...${app}.tiles.values()].every(t=>t.video.currentTime>0.3 && t.health.snapshot().firstFrameMs!==undefined)`,'Four tiles did not present real frames');
  const states=await evaluate('window.states');
  assert(states.every(s=>s.allocated<=4 && s.starting<=2),'Initial playback exceeded the allocation/startup budget');
  report.cases.fourFrames=await evaluate(`[...${app}.tiles.values()].map(t=>({id:t.id,width:t.video.videoWidth,height:t.video.videoHeight,frames:t.video.getVideoPlaybackQuality().totalVideoFrames,firstFrameMs:t.health.snapshot().firstFrameMs,precision:t.health.snapshot().precision}))`);
  assert(report.cases.fourFrames.every(t=>t.frames>0 && t.precision==='video-frame'),'A tile has no real frame evidence');
  report.desktopScreenshot=await screenshot('desktop');

  // Real keyboard routing: a single focused container gets the event, not all Players.
  await evaluate(`${app}.tiles.get('1').host.focus()`);await key('Space',' ',32);
  await until(`${app}.tiles.get('1').video.paused`,'Focused player did not pause');
  assert(await evaluate(`[...${app}.tiles.values()].slice(1).every(t=>!t.video.paused)`),'Keyboard paused unrelated players');
  await key('Space',' ',32);await until(`!${app}.tiles.get('1').video.paused`,'Focused player did not resume');
  // Shadow DOM native buttons must not trigger the host shortcut a second time.
  await evaluate(`${app}.tiles.get('2').host.querySelector('fyra-ui-shell').shadowRoot.querySelector('.btn-play').focus()`);
  await key('Space',' ',32);await until(`${app}.tiles.get('2').video.paused`,'Shadow button Space did not toggle exactly once');
  assert(await evaluate(`!${app}.tiles.get('1').video.paused && !${app}.tiles.get('3').video.paused`),'Shadow key affected another tile');
  await key('Space',' ',32);await until(`!${app}.tiles.get('2').video.paused`,'Shadow button did not resume');
  await evaluate(`document.querySelector('#starting-budget').focus()`);await key('KeyM','m',77);
  assert(await evaluate(`[...${app}.tiles.values()].every(t=>t.video.muted)`),'Form editing activated a player shortcut');
  report.cases.keyboard={oneFocusedPlayer:true,shadowButtonSingleToggle:true,formIgnored:true};

  await evaluate(`${coord}.setBudget(2,1)`);
  await until(`${coord}.snapshot().allocated===2 && ${coord}.snapshot().starting===0`,'Budget reduction did not release excess players');
  await evaluate(`${coord}.focus('4')`);
  await until(`${coord}.snapshot().tiles.find(t=>t.id==='4').state==='active' && ${coord}.snapshot().allocated===2`,'Focus did not prioritize fourth tile');
  assert(await evaluate(`!${app}.tiles.get('2').player && !${app}.tiles.get('3').player`),'Evicted resources remain alive');
  report.cases.focusBudget={allocated:2,focusedFourth:true};

  await evaluate(`${coord}.setPageVisible(false)`);await until(`${coord}.snapshot().allocated===0 && document.querySelectorAll('fyra-ui-shell').length===0`,'Background did not release UI and players');
  const background=await evaluate(`[...${app}.tiles.values()].map(t=>({player:!!t.player,src:t.video.getAttribute('src'),stream:t.video.srcObject}))`);
  assert(background.every(t=>!t.player && !t.src && t.stream===null),'Background retains media resources');
  await evaluate(`window.states=[];${coord}.setPageVisible(true)`);
  await until(`${coord}.snapshot().allocated===2 && ${coord}.snapshot().starting===0`,'Background return did not resume selected budget');
  assert((await evaluate('window.states')).every(s=>s.allocated<=2 && s.starting<=1),'Return exceeded startup concurrency');
  report.cases.background={release:true,restoredWithLimit:1};

  // Release an offscreen tile and retain explicit user stop across visibility changes.
  await evaluate(`${coord}.setVisible('4',false)`);
  await until(`!${app}.tiles.get('4').player && ${coord}.snapshot().starting===0`,'Offscreen focus did not release');
  await evaluate(`${coord}.setEnabled('1',false);${coord}.setVisible('4',true)`);
  await until(`${coord}.snapshot().tiles.find(t=>t.id==='4').state==='active' && !${app}.tiles.get('1').player`,'Visibility return restarted a disabled tile');
  report.cases.visibility={released:true,userStopPreserved:true};

  await evaluate(`document.querySelector('#stop-all').click()`);await until(`${coord}.snapshot().allocated===0`,'Stop all retained resources');
  await evaluate(`${app}.tiles.get('1').type.value='hls';${app}.tiles.get('1').input.value=${JSON.stringify(`${base}/bad.m3u8`)};document.querySelector('#start-all').click()`);
  await until(`${coord}.snapshot().tiles.find(t=>t.id==='1').state==='error' && ${coord}.snapshot().allocated===2 && ${coord}.snapshot().starting===0`,'One bad source blocked other tiles');
  assert(denied>0,'Invalid HLS never reached the network endpoint');
  const failures=denied;await sleep(1300);assert.equal(denied,failures,'Failed tile retry-loops without user intent');
  report.cases.failureIsolation={badRequests:denied,othersPlay:true,noRetryLoop:true};
  await evaluate(`document.querySelector('#stop-all').click()`);await until(`${coord}.snapshot().allocated===0`,'Final stop retained resources');

  if(hlsDirectory){
    await evaluate(`${app}.tiles.get('1').input.value=${JSON.stringify(`${base}/hls/index.m3u8`)};${app}.tiles.get('1').start.click()`);
    await until(`${coord}.snapshot().tiles.find(t=>t.id==='1').state==='active' && ${app}.tiles.get('1').video.currentTime>0.4`,'Valid HLS was rejected before ready/first frame');
    report.cases.hlsReady=await evaluate(`({time:${app}.tiles.get('1').video.currentTime,frames:${app}.tiles.get('1').video.getVideoPlaybackQuality().totalVideoFrames,firstFrameMs:${app}.tiles.get('1').health.snapshot().firstFrameMs})`);
    // Native toolbar stop must update scheduler intent instead of resurrecting the tile.
    await evaluate(`${app}.tiles.get('1').host.querySelector('fyra-ui-shell').shadowRoot.querySelector('.bar [data-act="stop"]').click()`);
    await until(`${coord}.snapshot().allocated===0 && !${coord}.snapshot().tiles[0].enabled`,'Skin stop did not disable scheduled tile');
  }

  // Mobile layout plus actual IntersectionObserver after scrolling.
  await session.send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:1,mobile:true});
  await sleep(400);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Mobile page overflows');
  await evaluate(`${app}.tiles.get('1').type.value='file';${app}.tiles.get('1').input.value=${JSON.stringify(`${base}/fixture.mp4`)};${coord}.focus(null);document.querySelector('#start-all').click()`);
  await until(`${coord}.snapshot().tiles.find(t=>t.id==='1').state==='active'`,'Mobile first visible tile did not start');
  report.mobileScreenshot=await screenshot('mobile');
  await evaluate(`${app}.tiles.get('4').root.scrollIntoView({block:'start'})`);
  await until(`${coord}.snapshot().tiles.find(t=>t.id==='1').state==='offscreen' && !${app}.tiles.get('1').player && ${coord}.snapshot().tiles.find(t=>t.id==='4').state==='active'`,'Actual scroll did not update offscreen allocation');
  report.cases.mobileScroll={offscreenReleased:true,visibleStarted:true};
  await evaluate(`(async()=>{clearInterval(window.watch);await ${app}.destroy();})()`);
  assert(await evaluate(`${coord}.snapshot().allocated===0 && document.querySelectorAll('fyra-ui-shell').length===0 && [...${app}.tiles.values()].every(t=>!t.host.hasAttribute('tabindex'))`),'Destroy leaked UI, resources or container focus state');
  report.passed=true;
}catch(error){report.failure=String(error);try{report.snapshot=await evaluate(`${coord}.snapshot()`);report.failureScreenshot=await screenshot('failure');}catch{}throw error;
}finally{
  writeFileSync(`${output}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(session){await session.send('Browser.close',{},3000).catch(()=>{});session.close();}child?.kill();
  server.closeAllConnections();server.close();
  if(!profile.startsWith(resolve(tmpdir())+sep+'fyra-multiview-smoke-'))throw new Error('Unsafe profile path');
  await sleep(1000);try{rmSync(profile,{recursive:true,force:true,maxRetries:2,retryDelay:500});}catch{console.warn('Browser profile remains locked: '+profile);}
}
