import {spawn, execFileSync} from 'node:child_process';
import {createWriteStream, existsSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {createSocket} from 'node:dgram';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));

// Optional loopback fixture. Owns only the child processes and new output directory it creates.
export async function createLiveFixture(options={}) {
  const mediamtx=options.mediamtx??process.env.FYRA_MEDIAMTX??(process.platform==='win32'?'G:/MTX/mediamtx.exe':'mediamtx');
  const ffmpeg=options.ffmpeg??process.env.FYRA_FFMPEG??'ffmpeg';
  const input=resolve(options.input??join(root,'examples/testvideo/Rec 0017.mp4'));
  if(!existsSync(input))throw new Error('Missing local video fixture: '+input);
  const parent=join(root,'.fyra-long-run');mkdirSync(parent,{recursive:true});
  const output=mkdtempSync(join(parent,'live-media-'));
  const ports={rtsp:28564,hls:28898,webrtc:28899,ice:28199,api:29997,...options.ports};
  for(const [name,port] of Object.entries(ports)){
    if(!Number.isInteger(port)||port<1024||port>65535)throw new RangeError('Invalid fixture port: '+name);
    await new Promise((done,reject)=>{
      const probe=name==='ice'?createSocket('udp4'):createServer();
      probe.once('error',reject);
      const opened=()=>probe.close(done);
      if(name==='ice'){probe.once('listening',opened);probe.bind(port,'127.0.0.1');}
      else probe.listen(port,'127.0.0.1',opened);
    });
  }
  const config=join(output,'mediamtx.yml');
  writeFileSync(config,[
    'logLevel: info','rtsp: yes','rtspTransports: [tcp]',`rtspAddress: 127.0.0.1:${ports.rtsp}`,
    'rtmp: no','srt: no','hls: yes',`hlsAddress: 127.0.0.1:${ports.hls}`,
    'hlsVariant: lowLatency','hlsAlwaysRemux: yes','hlsSegmentDuration: 1s','hlsSegmentCount: 7',
    'webrtc: yes',`webrtcAddress: 127.0.0.1:${ports.webrtc}`,`webrtcLocalUDPAddress: 127.0.0.1:${ports.ice}`,
    'webrtcIPsFromInterfaces: no','webrtcAdditionalHosts: [127.0.0.1]',
    'api: yes',`apiAddress: 127.0.0.1:${ports.api}`,'paths:','  all_others:',
  ].join('\n')+'\n');
  const children=new Set(), publishers=new Map();let server,serial=0;
  function launch(exe,args,label){
    const log=createWriteStream(join(output,label+'-'+(++serial)+'.log'));
    const child=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
    children.add(child);child.on('error',error=>{child.fixtureError=error;log.write(String(error));});
    child.on('spawn',()=>log.write('Fixture child started: '+child.pid+'\n'));
    child.on('close',(code,signal)=>{children.delete(child);log.end(`\nFixture child exited: code=${code} signal=${signal}\n`);});
    return child;
  }
  async function stop(child){
    if(!child||child.exitCode!==null)return;
    await new Promise(done=>{const timer=setTimeout(done,5000);child.once('close',()=>{clearTimeout(timer);done();});child.kill();});
  }
  async function ready(pathname,timeout=45000){
    const end=Date.now()+timeout;
    while(Date.now()<end){
      if(server?.fixtureError)throw server.fixtureError;
      if(server&&server.exitCode!==null)throw new Error('MediaMTX exited: '+server.exitCode+'; logs: '+output);
      try{const response=await fetch(`http://127.0.0.1:${ports.api}/v3/paths/list`,{signal:AbortSignal.timeout(1000)});
        if(response.ok&&server?.exitCode===null){const data=await response.json();if(!pathname||data.items.some(p=>p.name===pathname&&p.ready))return;}
      }catch{}await sleep(200);
    }
    throw new Error('MediaMTX did not become ready: '+(pathname??'API')+'; logs: '+output);
  }
  const clip=join(output,'video-aac.mp4');
  const info={output,input,ports,createdAt:new Date().toISOString(),mediamtxVersion:execFileSync(mediamtx,['--version'],{encoding:'utf8',windowsHide:true}).trim(),
    ffmpegVersion:execFileSync(ffmpeg,['-version'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/)[0],
    media:{width:1280,height:800,fps:25,video:'H.264',hlsAudio:'AAC',webrtcAudio:'Opus'},
    sources:{hls:{type:'hls',url:`http://127.0.0.1:${ports.hls}/hls/index.m3u8`},webrtc:{type:'webrtc',url:`http://127.0.0.1:${ports.webrtc}/rtc/whep`}},
    limits:'Looped local sample on loopback; not camera capture, WAN, TURN or speaker-output evidence.'};
  const api={...info,
    async startServer(){server=launch(mediamtx,[config],'mediamtx');await ready();},
    async stopServer(){await stop(server);},
    async startPublisher(name,opus=false){
      await api.stopPublisher(name);
      const args=['-hide_banner','-loglevel','warning','-nostdin','-re','-stream_loop','-1','-i',clip,
        '-map','0:v:0','-map','0:a:0','-c:v','copy',...(opus?['-c:a','libopus','-ar','48000','-ac','2']:['-c:a','copy']),
        '-f','rtsp','-rtsp_transport','tcp',`rtsp://127.0.0.1:${ports.rtsp}/${name}`];
      const child=launch(ffmpeg,args,'publisher-'+name);publishers.set(name,child);await ready(name);
    },
    async stopPublisher(name){const child=publishers.get(name);publishers.delete(name);await stop(child);},
    async close(){await Promise.all([...children].map(stop));},
  };
  try{
    const encode=launch(ffmpeg,['-hide_banner','-loglevel','warning','-nostdin','-i',input,'-t','7','-vf','scale=1280:800,fps=25',
      '-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-g','25','-keyint_min','25','-sc_threshold','0','-bf','0',
      '-c:a','aac','-ar','48000','-ac','2','-movflags','+faststart',clip],'encode');
    await new Promise((done,reject)=>{encode.once('error',reject);encode.once('close',code=>code===0?done():reject(new Error('Fixture encode failed; see '+output)));});
    await api.startServer();await api.startPublisher('hls');await api.startPublisher('rtc',true);
    writeFileSync(join(output,'ready.json'),JSON.stringify(info,null,2)+'\n');
    return api;
  }catch(error){await api.close();throw error;}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const fixture=await createLiveFixture();console.log(JSON.stringify(fixture,null,2));
  let closing=false;
  for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{if(closing)return;closing=true;await fixture.close();process.exit();});
}
