import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CdpSession, spawnBrowser, findBrowserExecutable, getDemoPage} from './browser-long-run.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
assert(process.argv[2]&&process.argv[3],'Pass baseline and candidate tarball paths');
const archives=process.argv.slice(2,4).map(resolvePath=>resolve(resolvePath));
const bundles=archives.map(file=>execFileSync('tar',['-xOf',file,'package/dist/fyraplayer.iife.js'],{maxBuffer:16*1024*1024}));
const identities=archives.map(file=>({file,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),version:JSON.parse(execFileSync('tar',['-xOf',file,'package/package.json'],{encoding:'utf8'})).version}));
const parent=join(root,'.fyra-long-run');mkdirSync(parent,{recursive:true});
const output=mkdtempSync(join(parent,'upgrade-'));
const media=readFileSync(join(root,'examples/testvideo/Rec 0017.mp4'));
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/sdk.js'){res.setHeader('Content-Type','application/javascript');res.end(bundles[Number(url.searchParams.get('index'))]);return;}
  if(url.pathname==='/video.mp4'){
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
    if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||media.length-1),media.length-1);if(start>end){res.writeHead(416);res.end();return;}
      res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':`bytes ${start}-${end}/${media.length}`,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});res.end(media.subarray(start,end+1));
    }else{res.setHeader('Content-Type','video/mp4');res.end(media);}return;
  }
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="host"><video muted playsinline></video></div><script src="/sdk.js?index='+Number(url.searchParams.get('index'))+'"></script>');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}`,port=Number(process.env.FYRA_SMOKE_CDP_PORT??9606);
const profile=mkdtempSync(join(tmpdir(),'fyra-upgrade-'));
const sleep=ms=>new Promise(done=>setTimeout(done,ms));let session,child;
const report={startedAt:new Date().toISOString(),artifacts:identities,cases:[],limits:'Representative SDK consumer using common APIs; not the user business application or all behavior/type compatibility.'};
async function evaluate(expression){const r=await session.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},45000);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;}
async function until(expression){const end=Date.now()+15000;while(Date.now()<end){if(await evaluate(expression))return;await sleep(100);}throw Error('Consumer condition failed: '+expression);}
try{
  child=spawnBrowser(findBrowserExecutable({browser:'edge'}),port,profile,'about:blank',{headless:true});
  for(let n=0;n<100;n++){try{if((await fetch(`http://127.0.0.1:${port}/json`)).ok)break;}catch{}await sleep(250);}
  session=new CdpSession((await getDemoPage(port,'about:blank')).webSocketDebuggerUrl);
  report.browser=(await session.send('Browser.getVersion')).product;
  for(let index=0;index<archives.length;index++){
    await session.send('Page.navigate',{url:base+'/?index='+index});await until('!!window.FyraPlayerSDK');
    // This application body is identical for both packages and uses only 1.0.2 public APIs.
    await evaluate(`(async()=>{
      const {FyraPlayer,createUiComponentsPlugin}=FyraPlayerSDK;
      window.video=document.querySelector('video');window.events=[];window.plugins={setup:0,destroy:0};
      window.createPlayer=()=>{
        const player=new FyraPlayer({video,autoplay:true,muted:true,sources:[{type:'file',url:'/video.mp4?a'},{type:'file',url:'/video.mp4?b'}],plugins:[
          ()=>{plugins.setup++;return {destroy(){plugins.destroy++;}};},createUiComponentsPlugin({target:'#host'})]});
        player.on('ready',()=>events.push('ready'));player.on('play',()=>events.push('play'));player.on('pause',()=>events.push('pause'));
        return player;
      };
      window.player=createPlayer();await player.init();
    })()`);
    await until('video.currentTime>0.3&&!video.paused');
    const first=await evaluate('({width:video.videoWidth,height:video.videoHeight,frames:video.getVideoPlaybackQuality().totalVideoFrames,source:player.getCurrentSource().url,ui:document.querySelectorAll("fyra-ui-shell").length})');
    assert(first.frames>0&&first.ui===1);
    await evaluate('player.pause()');assert(await evaluate('video.paused'),'Pause failed');
    await evaluate('player.play()');await until('!video.paused');
    await evaluate('player.switchSource(1)');await until('video.currentTime>0.3&&!video.paused&&player.getCurrentSource().url.endsWith("?b")');
    await evaluate('player.destroy()');assert(await evaluate('document.querySelectorAll("fyra-ui-shell").length===0&&plugins.destroy===1'),'Destroy leaked UI/plugin');
    await evaluate('(async()=>{window.player=createPlayer();await player.init();})()');await until('video.currentTime>0.3&&!video.paused');
    await evaluate('player.destroy()');
    const final=await evaluate('({events,plugins,ui:document.querySelectorAll("fyra-ui-shell").length,src:video.getAttribute("src"),stream:video.srcObject})');
    assert.equal(final.ui,0);assert.equal(final.plugins.setup,2);assert.equal(final.plugins.destroy,2);assert.equal(final.stream,null);assert(!final.src);
    assert(final.events.includes('ready')&&final.events.includes('play')&&final.events.includes('pause'));
    report.cases.push({version:identities[index].version,first,final});
  }
  report.passed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
  report.finishedAt=new Date().toISOString();writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,...report},null,2));
  if(session){await session.send('Browser.close',{},3000).catch(()=>{});session.close();}child?.kill();server.closeAllConnections();server.close();
  if(!profile.startsWith(resolve(tmpdir())+sep+'fyra-upgrade-'))throw Error('Unsafe profile path');await sleep(1000);try{rmSync(profile,{recursive:true,force:true,maxRetries:2,retryDelay:500});}catch{console.warn('Locked profile retained: '+profile);}
}
