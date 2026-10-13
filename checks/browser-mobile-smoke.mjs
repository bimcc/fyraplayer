import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { CdpSession, spawnBrowser, findBrowserExecutable, getDemoPage } from './browser-long-run.mjs';

// Chromium mobile emulation validates layout/touch contracts; it is not an iOS device run.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), site = join(root,'site-dist');
const output = resolve(process.env.FYRA_MOBILE_OUTPUT ?? join(root,'.fyra-long-run/mobile-browser'));
mkdirSync(dirname(output),{recursive:true});
const fixture = readFileSync(join(root,'examples/testvideo/Rec 0017.mp4'));
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const server = createServer((req,res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  const path = new URL(req.url,'http://localhost').pathname;
  if(path === '/bad.m3u8') {res.writeHead(403);res.end('Forbidden');return;}
  const file = resolve(site,'.'+decodeURIComponent(path));
  if(path !== '/fixture.mp4' && (!file.startsWith(site+sep) || !existsSync(file))) {res.writeHead(404);res.end();return;}
  const data = path === '/fixture.mp4' ? fixture : readFileSync(file);
  const type = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.mp4':'video/mp4'}[extname(path)] ?? 'application/octet-stream';
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if(range) {
    const start = Number(range[1]),end = Math.min(range[2] ? Number(range[2]) : data.length-1,data.length-1);
    if(start>end){res.writeHead(416);res.end();return;}
    res.writeHead(206,{'Content-Type':type,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${data.length}`,'Accept-Ranges':'bytes'});
    res.end(data.subarray(start,end+1));
  } else {res.writeHead(200,{'Content-Type':type,'Content-Length':data.length,'Accept-Ranges':'bytes'});res.end(data);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`, demo=process.env.FYRA_MOBILE_DEMO_URL ?? `${base}/basic.html`;
const port=Number(process.env.FYRA_MOBILE_CDP_PORT ?? 9521),profile=mkdtempSync(join(tmpdir(),'fyra-mobile-smoke-'));
let child,session;
const report={demo,emulation:'Chromium touch, no physical Android/iOS claim',cases:{}};
async function evaluate(expression) {
  const result=await session.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression,message,timeout=20000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await evaluate(expression))return;await sleep(100);}
  throw Error(message);
}
const shell="document.querySelector('fyra-ui-shell').shadowRoot";
async function tap(elementExpression) {
  await evaluate(`(${elementExpression}).scrollIntoView({block:'nearest'})`);await sleep(150);
  const point=await evaluate(`(()=>{const e=${elementExpression};const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()`);
  assert(point.width>0 && point.height>0,'Touch target is hidden');
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await sleep(100);
}
async function size(width,height) {
  await session.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
  await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await sleep(400);
}
async function load(type,url) {
  await until('!document.querySelector("#btn-load").disabled','Load controls locked');
  await evaluate(`document.querySelector('#input-url').value=${JSON.stringify(url)};document.querySelector('#type-select').value=${JSON.stringify(type)}`);
  await tap("document.querySelector('#btn-load')");
}
async function screenshot(suffix,full=false) {
  await evaluate('window.scrollTo(0,0)');await sleep(150);
  const clip=full ? undefined : await evaluate("(()=>{const r=document.querySelector('.player-shell').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()");
  const shot=await session.send('Page.captureScreenshot',{format:'png',...(clip?{clip}:{})});
  const path=`${output}-${suffix}.png`;writeFileSync(path,Buffer.from(shot.data,'base64'));return path;
}
async function geometry(panorama=false) {
  const info=await evaluate(`(()=>{
    const host=document.querySelector('.player-shell'),root=${panorama ? "host.querySelector('.fyra-panoramalite-viewer-controls')" : shell};
    const bar=root.querySelector('${panorama ? '.fyra-panoramalite-bar' : '.bar'}'),r=host.getBoundingClientRect();
    const buttons=[...bar.querySelectorAll(':scope > button,:scope > div > button')].filter(b=>b.getBoundingClientRect().width>0).map(b=>{const t=b.getBoundingClientRect();return {x:t.x,y:t.y,right:t.right,width:t.width,height:t.height};});
    return {viewport:innerWidth,page:document.documentElement.scrollWidth,host:{x:r.x,right:r.right,width:r.width,height:r.height},buttons};
  })()`);
  assert(info.page<=info.viewport+1,'Page has horizontal overflow');
  assert(info.buttons.every(b=>b.width>=44 && b.height>=44),'Mobile controls have small touch targets');
  assert(info.buttons.every(b=>b.x>=info.host.x-1 && b.right<=info.host.right+1),'Player controls overflow');
  assert(info.buttons.every(b=>Math.abs(b.y-info.buttons[0].y)<1),'Mobile buttons wrap');
  return info;
}
try {
  child=spawnBrowser(findBrowserExecutable({browser:'edge'}),port,profile,'about:blank',{headless:true});
  for(let n=0;n<80;n++){try{if((await fetch(`http://127.0.0.1:${port}/json`)).ok)break;}catch{}await sleep(250);}
  session=new CdpSession((await getDemoPage(port,'about:blank')).webSocketDebuggerUrl);
  await size(393,852);await session.send('Page.navigate',{url:demo});
  await until('!!window.fyraLongRun','Demo initialization failed');
  report.cases.capabilities=await evaluate(`(()=>{
    const type=document.querySelector('#type-select'),gb=document.querySelector('#gb-section'),hevc=document.querySelector('#wt-hevc-option');
    const shown=element=>getComputedStyle(element).display!=='none';
    const original=type.value;type.value='file';type.dispatchEvent(new Event('change'));
    const regular={gb:shown(gb),hevc:shown(hevc)};
    type.value='webtransport';type.dispatchEvent(new Event('change'));const webtransport={gb:shown(gb),hevc:shown(hevc),versionChooser:!!document.querySelector('#wt-protocol')};
    type.value='gb28181';type.dispatchEvent(new Event('change'));const gateway={gb:shown(gb),hevc:shown(hevc)};
    type.value=original;type.dispatchEvent(new Event('change'));
    return {regular,webtransport,gateway,reports:['mse-support','native-support','wc-support'].map(id=>document.getElementById(id).textContent)};
  })()`);
  assert(!report.cases.capabilities.regular.gb && !report.cases.capabilities.regular.hevc,'Ordinary playback shows advanced configuration');
  assert(!report.cases.capabilities.webtransport.gb && report.cases.capabilities.webtransport.hevc && !report.cases.capabilities.webtransport.versionChooser,'WebTransport controls are not simplified');
  assert(report.cases.capabilities.gateway.gb && !report.cases.capabilities.gateway.hevc,'Gateway compatibility panel is not conditional');
  assert(await evaluate("matchMedia('(pointer:coarse)').matches && innerWidth===393"),'Mobile viewport/touch emulation did not apply');
  await size(320,720);
  await evaluate("document.querySelector('#type-select').value='webtransport';document.querySelector('#type-select').dispatchEvent(new Event('change'))");
  report.cases.transportLayout=await evaluate("({page:document.documentElement.scrollWidth,viewport:innerWidth})");
  assert(report.cases.transportLayout.page<=321,'Transport configuration overflows the 320px mobile page');
  report.transportLayout=await screenshot('webtransport-config',true);
  await load('webtransport','https://127.0.0.1:9444/unavailable');
  await until("window.fyraPlayer?.getCurrentSource()?.type==='webtransport'",'WebTransport source was not forwarded to the player');
  report.cases.transportSource=await evaluate('window.fyraPlayer.getCurrentSource()');
  assert(!('protocol' in report.cases.transportSource),'WebTransport source still contains a protocol selector');
  await tap("document.querySelector('#btn-stop')");
  await until("!document.querySelector('#btn-load').disabled && !window.fyraPlayer",'Transport startup stop did not unlock the demo');
  await size(393,852);
  await load('file',`${base}/fixture.mp4`);
  await until("window.fyraPlayer?.getState()==='ready'",'MP4 not ready');
  await evaluate("document.querySelector('video').muted=true;document.querySelector('video').loop=true;window.scrollTo(0,0)");
  await tap(`${shell}.querySelector('.big-play')`);
  await until("!document.querySelector('video').paused && document.querySelector('video').currentTime>0.3",'Touch play failed');
  assert(await evaluate("document.querySelector('video').playsInline"),'Inline playback is not enabled');
  report.cases.portrait=await geometry();report.portrait=await screenshot('portrait',true);
  await sleep(3600);
  assert(await evaluate(`${shell}.querySelector('.shell').classList.contains('hide-controls')`),'Touch controls did not auto-hide');
  await tap(`${shell}.querySelector('.click-area')`);
  assert(await evaluate(`!${shell}.querySelector('.shell').classList.contains('hide-controls') && !document.querySelector('video').paused`),'Touch wake-up paused the video or left controls hidden');
  await tap(`${shell}.querySelector('.btn-play')`);
  await until("document.querySelector('video').paused",'Touch pause failed');
  report.cases.tap={starts:true,wakesWithoutPausing:true,pauses:true};

  const seek=await evaluate(`(()=>{const r=${shell}.querySelector('.progress').getBoundingClientRect();return {x:r.x,y:r.y+r.height/2,width:r.width,scrollY};})()`);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:seek.x+seek.width*0.15,y:seek.y,id:1}]});
  for(const fraction of [0.25,0.4,0.6]) {
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:seek.x+seek.width*fraction,y:seek.y,id:1}]});
    await sleep(40);
  }
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const seekResult=await evaluate("({fraction:document.querySelector('video').currentTime/document.querySelector('video').duration,scrollY})");
  assert(Math.abs(seekResult.fraction-0.6)<0.06 && seekResult.scrollY===seek.scrollY,'Touch seek failed or scrolled the page');
  report.cases.seek=seekResult;

  await tap(`${shell}.querySelector('.btn-play')`);
  await tap(`${shell}.querySelector('[data-act="more"]')`);
  await sleep(3400);
  assert(await evaluate(`!${shell}.querySelector('.shell').classList.contains('hide-controls')`),'Open menu was hidden during playback');
  await tap(`${shell}.querySelector('.click-area')`);
  assert(await evaluate(`!${shell}.querySelector('.more-wrap').classList.contains('open')`),'Background tap did not close menu');
  await tap(`${shell}.querySelector('.click-area')`);
  await tap(`${shell}.querySelector('.btn-play')`);
  await until("document.querySelector('video').paused",'Pause after menu test failed');

  await tap(`${shell}.querySelector('[data-act="more"]')`);
  assert(await evaluate(`${shell}.querySelector('.more-wrap').classList.contains('open') && getComputedStyle(${shell}.querySelector('.more-menu')).visibility==='visible'`),'More menu requires hover');
  await tap(`${shell}.querySelector('[data-act="speed-more"]')`);
  assert(await evaluate("document.querySelector('video').playbackRate!==1"),'Touch speed selection did not work');
  assert(await evaluate(`!${shell}.querySelector('.more-wrap').classList.contains('open')`),'Menu did not close after selection');
  await size(320,720);report.cases.narrow=await geometry();report.narrow=await screenshot('narrow');
  await size(844,390);report.cases.landscape=await geometry();
  await tap(`${shell}.querySelector('[data-act="speed"]')`);
  await tap(`${shell}.querySelector('[data-speed="1"]')`);
  assert(await evaluate("document.querySelector('video').playbackRate===1"),'Landscape speed menu does not work by tap');
  report.cases.menus={more:true,speed:true};

  // Force the mobile fallback without replacing the video with native fullscreen.
  await evaluate("window.originalHostStyles=document.querySelector('.player-shell').style.cssText;window.originalOverflow=document.body.style.overflow;document.querySelector('.player-shell').requestFullscreen=undefined;document.querySelector('.player-shell').webkitRequestFullscreen=undefined");
  await tap(`${shell}.querySelector('[data-act="fs"]')`);
  await until("document.querySelector('.player-shell').hasAttribute('data-fyra-page-fullscreen')",'Page fullscreen fallback failed');
  const full=await evaluate("(()=>{const r=document.querySelector('.player-shell').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()");
  assert(full.x===0 && full.y===0 && Math.abs(full.width-844)<1 && Math.abs(full.height-390)<1,'Page fullscreen does not fill viewport');
  await size(393,852);
  assert(await evaluate("Math.abs(document.querySelector('.player-shell').getBoundingClientRect().height-852)<1"),'Fullscreen did not follow orientation change');
  await tap(`${shell}.querySelector('[data-act="fs"]')`);
  assert(await evaluate("document.querySelector('.player-shell').style.cssText===window.originalHostStyles && document.body.style.overflow===window.originalOverflow"),'Fullscreen changed application styles or left page scrolling locked');
  report.cases.fullscreen={pageFallback:true,orientation:true,restoresStyles:true};

  await size(393,852);
  await load('hls',`${base}/bad.m3u8`);
  await until(`${shell}.querySelector('.status-card').classList.contains('show')`,'Error status did not appear');
  await tap(`${shell}.querySelector('[data-role="cancel"]')`);
  await until("window.fyraPlayer?.getState()==='idle' && !document.querySelector('#btn-load').disabled",'Touch stop did not recover bad-address state');
  report.cases.stop={recovered:true};

  await load('file',`${base}/fixture.mp4`);await until("window.fyraPlayer?.getState()==='ready'",'Reload after touch stop failed');
  await evaluate("window.fyraPanorama.setEnabled(true)");
  // Reload with CORS configured before assigning src, required for video textures.
  await load('file',`${base}/fixture.mp4`);await until("window.fyraPlayer?.getState()==='ready'",'Panorama not ready');
  await evaluate("document.querySelector('video').muted=true;document.querySelector('video').loop=true;window.scrollTo(0,0)");
  await tap("document.querySelector('.fyra-panoramalite-bar button[data-icon="+JSON.stringify('play')+"]')");
  await until("!document.querySelector('video').paused",'Panorama touch play failed');
  report.cases.panoramaPortrait=await geometry(true);
  await sleep(3400);
  assert(await evaluate("getComputedStyle(document.querySelector('.fyra-panoramalite-viewer-controls')).opacity==='0'"),'Panorama touch controls did not auto-hide');
  const beforeWake=await evaluate('window.fyraPanorama.getHandle().getView()');
  await tap("document.querySelector('canvas')");
  await until("getComputedStyle(document.querySelector('.fyra-panoramalite-viewer-controls')).opacity==='1'",'Panorama touch did not wake controls');
  const afterWake=await evaluate('window.fyraPanorama.getHandle().getView()');
  assert.deepEqual(afterWake,beforeWake,'Wake tap changed panorama view');
  const canvas=await evaluate("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+70,y:r.y+55};})()");
  const before=await evaluate('window.fyraPanorama.getHandle().getView()');
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...canvas,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:canvas.x+60,y:canvas.y+20,id:1}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const dragged=await evaluate('window.fyraPanorama.getHandle().getView()');
  assert(Math.abs(dragged.yaw-before.yaw)>5,'Touch drag did not pan');
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...canvas,id:1},{x:canvas.x+100,y:canvas.y,id:2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:canvas.x-10,y:canvas.y,id:1},{x:canvas.x+130,y:canvas.y,id:2}]});
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const pinched=await evaluate('window.fyraPanorama.getHandle().getView()');
  assert(pinched.fov<dragged.fov-1,'Pinch did not zoom');assert(Math.abs(pinched.yaw-dragged.yaw)<0.1,'Pinch also rotated the panorama');
  report.cases.gestures={before,dragged,pinched};report.panorama=await screenshot('panorama');
  await size(320,720);report.cases.panoramaNarrow=await geometry(true);
  await size(844,390);report.cases.panoramaLandscape=await geometry(true);
  await tap("document.querySelector('.fyra-panoramalite-bar button[data-icon="+JSON.stringify('fullscreen')+"]')");
  await until("document.querySelector('.player-shell').hasAttribute('data-fyra-page-fullscreen')",'Panorama page fallback failed');
  await tap("document.querySelector('.fyra-panoramalite-bar button[data-icon="+JSON.stringify('exitFullscreen')+"]')");
  assert(await evaluate("!document.querySelector('.player-shell').hasAttribute('data-fyra-page-fullscreen')"),'Panorama fallback did not exit');
  await tap("document.querySelector('.fyra-panoramalite-bar button[data-icon="+JSON.stringify('fullscreen')+"]')");
  await evaluate('window.fyraPlayer.destroy()');
  await until("document.querySelectorAll('fyra-ui-shell,.fyra-panoramalite-viewer-controls').length===0",'Mobile plugins leaked after stop');
  assert(await evaluate("!document.querySelector('.player-shell').hasAttribute('data-fyra-page-fullscreen') && document.body.style.overflow===window.originalOverflow"),'Destroy left fullscreen or scroll lock behind');
  report.cases.fullscreen.destroyRestoresScroll=true;

  // Check the independently packaged IIFE at the same narrow width, including
  // the source selector relocated into More. Native select choice uses change.
  await size(320,720);
  await session.send('Page.navigate',{url:`${base}/minimal-iife.html?file=/fixture.mp4`});
  await until("window.fyraPlayer?.getVideoElement().currentTime>0.2",'Mobile IIFE did not play');
  await evaluate(`(async()=>{
    await window.fyraPlayer.destroy();
    window.fyraPlayer=new window.FyraPlayerSDK.FyraPlayer({
      video:'#player', sources:[{type:'file',url:'/fixture.mp4'},{type:'file',url:'/fixture.mp4?v=2'}],
      plugins:[window.FyraPlayerSDK.createUiComponentsPlugin({target:'.player-shell'}),ctx=>{window.qualityEvents=ctx.coreBus;}]
    });
    await window.fyraPlayer.init();
  })()`);
  report.cases.iifeNarrow=await geometry();
  await tap(`${shell}.querySelector('[data-act="more"]')`);
  await sleep(250); // Wait for the menu scale transition before measuring targets.
  report.cases.sourceSelector=await evaluate(`(()=>{const e=${shell}.querySelector('.quality-more');return {height:e.getBoundingClientRect().height,count:e.options.length,display:getComputedStyle(e.parentElement).display};})()`);
  assert(report.cases.sourceSelector.height>=44 && report.cases.sourceSelector.count===2,'Mobile source selector is missing or too small');
  await evaluate(`(()=>{const select=${shell}.querySelector('.quality-more');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until("window.fyraPlayer.getCurrentSource()?.url==='/fixture.mp4?v=2' && window.fyraPlayer.getState()==='ready'",'Mobile menu source change failed');
  assert(await evaluate(`!${shell}.querySelector('.more-wrap').classList.contains('open') && ${shell}.querySelector('.quality-more').value==='1'`),'Mobile source selection/menu state was lost');
  report.cases.sourceMenu={visible:true,selection:true};
  // Feed public quality-state/events to the real UI; this fixture tests UI behavior,
  // not the network adaptation algorithms of HLS/DASH.
  await evaluate(`(()=>{
    const p=window.fyraPlayer;p.getSources=()=>[p.getCurrentSource()];
    window.qualityState={supported:true,auto:true,current:null,levels:[{id:0,height:720}]};
    p.getQualityState=()=>window.qualityState;
    p.setQualityLevel=async value=>{window.selectedQuality=value;window.qualityState.auto=value==='auto';window.qualityState.current=value==='auto'?null:value;window.qualityEvents.emit('levelSwitch',{});};
    window.qualityEvents.emit('levelSwitch',{});
  })()`);
  assert(await evaluate(`getComputedStyle(${shell}.querySelector('.quality-menu-row')).display==='none'`),'Single-level stream offers a meaningless quality choice');
  await evaluate(`window.qualityState.levels.push({id:1,height:1080});window.qualityEvents.emit('levelSwitch',{})`);
  assert.deepEqual(await evaluate(`Array.from(${shell}.querySelector('.quality-more').options,o=>o.textContent)`),['Auto','720p','1080p'],'Adaptive levels or Auto are missing');
  await evaluate(`(()=>{const s=${shell}.querySelector('.quality-more');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`window.selectedQuality===1 && ${shell}.querySelector('.quality-more').value==='1'`,'Manual quality choice did not reach Player');
  await evaluate(`(()=>{const s=${shell}.querySelector('.quality-more');s.value='auto';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(`window.selectedQuality==='auto' && ${shell}.querySelector('.quality-more').value==='auto'`,'Auto did not restore adaptive mode');
  report.cases.qualityChoices={singleHidden:true,multipleWithAuto:true,manualAndAuto:true};
  await evaluate('window.fyraPlayer.destroy()');

  report.passed=true;writeFileSync(`${output}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} catch(error) {
  report.failure=String(error);
  try {
    report.state=await evaluate(`({state:window.fyraPlayer?.getState(),log:document.querySelector('#log')?.textContent,loadDisabled:document.querySelector('#btn-load')?.disabled,viewport:{width:innerWidth,height:innerHeight,scrollY},active:document.activeElement?.tagName})`);
    report.failureScreenshot=await screenshot('failure',true);
  } catch{}
  writeFileSync(`${output}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));throw error;
} finally {
  if(session){await session.send('Browser.close',{},3000).catch(()=>{});session.close();}child?.kill();
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  if(!profile.startsWith(resolve(tmpdir())+sep+'fyra-mobile-smoke-'))throw Error('Unsafe profile path');
  await sleep(1000);try{rmSync(profile,{recursive:true,force:true,maxRetries:2,retryDelay:500});}catch{console.warn(`Browser profile remains locked: ${profile}`);}
}
