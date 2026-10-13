import {WebTransportTech} from '../src/plugins/webtransport/tech.js';
import {createWebTransportTechPlugin} from '../src/plugins/webtransport.js';
import {encodeTransportConfig,encodeTransportChunk,encodeTransportMetadata} from '../src/plugins/webtransport/protocol.js';
import {createWebTransportKlvIntegration} from '../examples/integrations/webtransport-klv.js';
import {FyraPlayer} from '../src/player.js';
import {resetMockTechInstances} from './mocks/tech-base.js';
import type {Source} from '../src/types.js';
const source:Source={type:'webtransport',url:'https://localhost:4433/video'};
const config={codec:'avc1.42E01E',codedWidth:320,codedHeight:200};
class Chunk {constructor(public init:EncodedVideoChunkInit) {} }
class Decoder {
  static supported=true;
  static holdOutput=false;
  static isConfigSupported=jest.fn(async()=>({supported:Decoder.supported}));
  static instances:Decoder[]=[];
  state='unconfigured'; decodeQueueSize=0;
  configure=jest.fn(()=>{this.state='configured';});reset=jest.fn(()=>{this.state='unconfigured';this.pending=[];this.decodeQueueSize=0;});
  close=jest.fn(()=>{this.state='closed';this.pending=[];this.decodeQueueSize=0;});flush=jest.fn(async()=>{});
  pending:Chunk[]=[];
  frames:Array<{close:jest.Mock;timestamp:number}>=[];
  constructor(public callbacks:VideoDecoderInit){Decoder.instances.push(this);}
  decode(chunk:Chunk){
    if(Decoder.holdOutput){this.pending.push(chunk);this.decodeQueueSize++;return;}
    this.output(chunk);
  }
  drain(){const pending=this.pending;this.pending=[];this.decodeQueueSize=0;for(const chunk of pending)this.output(chunk);}
  private output(chunk:Chunk){
    const frame={timestamp:chunk.init.timestamp,displayWidth:320,displayHeight:200,close:jest.fn()};this.frames.push(frame);
    queueMicrotask(()=>this.callbacks.output(frame as unknown as VideoFrame));
  }
}
class Session {
  static instances:Session[]=[];
  static pending=false;
  ready:Promise<void>;
  resolveReady!:()=>void;
  closed=new Promise(()=>{});
  close=jest.fn();
  incomingUnidirectionalStreams:ReadableStream<ReadableStream<Uint8Array>>;
  chunks!:ReadableStreamDefaultController<Uint8Array>;
  streams!:ReadableStreamDefaultController<ReadableStream<Uint8Array>>;
  constructor(){
    Session.instances.push(this);this.ready=new Promise(r=>{this.resolveReady=r;});if(!Session.pending)this.resolveReady();
    this.incomingUnidirectionalStreams=new ReadableStream({start:c=>{this.streams=c;}});
    this.streams.enqueue(new ReadableStream({start:c=>{this.chunks=c;}}));
  }
  send(){this.chunks.enqueue(encodeTransportConfig(config));this.chunks.enqueue(encodeTransportChunk({key:true,timestamp:1000000,data:new Uint8Array([1])}));}
}
const tick=()=>new Promise(r=>setTimeout(r,0));
describe('optional WebTransport Tech ownership',()=>{
  const names=['document','WebTransport','VideoDecoder','EncodedVideoChunk'] as const;
  const originals=new Map(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let tech:WebTransportTech,video:HTMLVideoElement,track:{stop:jest.Mock},draw:jest.Mock;
  beforeEach(()=>{
    resetMockTechInstances();Decoder.instances=[];Decoder.supported=true;Decoder.holdOutput=false;Decoder.isConfigSupported.mockClear();Session.instances=[];Session.pending=false;
    track={stop:jest.fn()};draw=jest.fn();
    const canvas={width:0,height:0,getContext:()=>({drawImage:draw}),captureStream:()=>({getTracks:()=>[track]})};
    for(const [key,value] of Object.entries({document:{createElement:()=>canvas},WebTransport:Session,VideoDecoder:Decoder,EncodedVideoChunk:Chunk}))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
    video={paused:true,srcObject:null,load(){},play:jest.fn(async()=>{Object.assign(video,{paused:false});}),pause:jest.fn(()=>{Object.assign(video,{paused:true});}),addEventListener(){},removeEventListener(){}} as unknown as HTMLVideoElement;
    tech=new WebTransportTech();
  });
  afterEach(async()=>{
    await tech.destroy();
    for(const key of names){const original=originals.get(key);if(original)Object.defineProperty(globalThis,key,original);else Reflect.deleteProperty(globalThis,key);}
  });
  test('loads only after decoded video, delivers original clock, preserves pause/play and clears tracks',async()=>{
    const onFrame=jest.fn();tech=new WebTransportTech({onFrame});const ready=jest.fn();tech.on('ready',ready);
    const loading=tech.load(source,{video});await tick();expect(ready).not.toHaveBeenCalled();
    Session.instances[0].send();await loading;
    expect(ready).toHaveBeenCalledTimes(1);expect(onFrame.mock.calls[0][1]).toMatchObject({timestamp:1000000,mediaTime:1});
    expect(draw).toHaveBeenCalledTimes(1);expect(Decoder.instances[0].frames[0].close).toHaveBeenCalledTimes(1);
    expect(video.srcObject).not.toBeNull();await tech.play();await tech.pause();expect(video.paused).toBe(true);
    await tech.destroy();expect(video.srcObject).toBeNull();expect(track.stop).toHaveBeenCalledTimes(1);expect(Session.instances[0].close).toHaveBeenCalledTimes(1);
  });
  test('abort during session.ready rejects promptly; late ready cannot reopen readers',async()=>{
    Session.pending=true;const controller=new AbortController();const ready=jest.fn();tech.on('ready',ready);
    const loading=tech.load(source,{video,signal:controller.signal});const rejected=expect(loading).rejects.toMatchObject({name:'AbortError'});
    await tick();controller.abort();await rejected;
    Session.instances[0].resolveReady();await tick();expect(ready).not.toHaveBeenCalled();expect(Session.instances[0].close).toHaveBeenCalledTimes(1);
  });
  test('plays video-only records and raw metadata without any KLV plugin',async()=>{
    const metadata=jest.fn(), network=jest.fn();tech.on('metadata',metadata);tech.on('network',network);
    const loading=tech.load({type:'webtransport',url:source.url},{video});await tick();
    Session.instances[0].send();await loading;
    expect(tech.getLatestFrame()?.timestamp).toBe(1000000);
    expect(metadata).not.toHaveBeenCalled();
    expect(network).toHaveBeenCalledWith(expect.objectContaining({type:'wt-open',protocol:'fyra-media'}));
    Session.instances[0].chunks.enqueue(encodeTransportMetadata({type:'private-data',timestamp:1100000,data:new Uint8Array([255])}));
    Session.instances[0].chunks.enqueue(encodeTransportChunk({key:false,timestamp:1100000,data:new Uint8Array([2])}));await tick();
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(tech.getLatestFrame()?.timestamp).toBe(1100000);
    expect(Decoder.instances).toHaveLength(1);
  });
  test('first frame deadline also covers a session that opens but never sends config',async()=>{
    tech=new WebTransportTech({startupTimeoutMs:20});
    await expect(tech.load(source,{video})).rejects.toMatchObject({name:'TimeoutError'});
    expect(Session.instances[0].close).toHaveBeenCalledTimes(1);
  });
  test('HEVC requires explicit opt-in and exact configuration support',async()=>{
    const loading=tech.load(source,{video});const rejected=expect(loading).rejects.toThrow('allowH265');await tick();
    Session.instances[0].chunks.enqueue(encodeTransportConfig({...config,codec:'hvc1.1.6.L93.B0'}));await rejected;
    Decoder.supported=false;
    const second=tech.load({...source,allowH265:true} as Source,{video});const unsupported=expect(second).rejects.toThrow('does not support');await tick();
    Session.instances[1].chunks.enqueue(encodeTransportConfig({...config,codec:'hvc1.1.6.L93.B0'}));await unsupported;
  });
  test('queue overflow drops to the next keyframe and configuration changes reset the timeline',async()=>{
    tech=new WebTransportTech({maxDecodeQueue:2});const changes=jest.fn();tech.on('streamchange',changes);
    const loading=tech.load(source,{video});await tick();Session.instances[0].send();await loading;
    Decoder.instances[0].decodeQueueSize=2;
    Session.instances[0].chunks.enqueue(encodeTransportChunk({key:false,timestamp:1100000,data:new Uint8Array([2])}));await tick();
    expect(tech.getStats().droppedFrames).toBe(1);expect(Decoder.instances[0].reset).toHaveBeenCalled();
    Session.instances[0].chunks.enqueue(encodeTransportConfig(config));Session.instances[0].chunks.enqueue(encodeTransportChunk({key:true,timestamp:0,data:new Uint8Array([3])}));await tick();
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({reason:'discontinuity'}));expect(tech.getStats().mediaTime).toBe(0);
  });
  test.each(['avc1.42E01E','hvc1.1.6.L93.B0'])('slow %s startup keeps the first keyframe and recovers at a later keyframe',async codec=>{
    Decoder.holdOutput=true;tech=new WebTransportTech({maxDecodeQueue:2});const network=jest.fn();tech.on('network',network);
    const loading=tech.load({...source,allowH265:true},{video});await tick();
    const stream=Session.instances[0];stream.chunks.enqueue(encodeTransportConfig({...config,codec}));
    for(let i=0;i<12;i++)stream.chunks.enqueue(encodeTransportChunk({key:i===0,timestamp:i*50000,data:new Uint8Array([1])}));
    await tick();const decoder=Decoder.instances[0];
    expect(decoder.reset).not.toHaveBeenCalled();expect(decoder.configure).toHaveBeenCalledTimes(1);
    expect(decoder.pending.map(chunk=>chunk.init.timestamp)).toEqual([0,50000]);
    expect(tech.getStats().droppedFrames).toBe(10);
    expect(network).toHaveBeenCalledWith(expect.objectContaining({type:'catchup',reason:'decode-queue-warmup'}));
    decoder.drain();await loading;expect(tech.getLatestFrame()?.timestamp).toBe(50000);
    stream.chunks.enqueue(encodeTransportChunk({key:false,timestamp:600000,data:new Uint8Array([1])}));await tick();
    expect(decoder.pending).toHaveLength(0); // References were dropped; delta frames cannot resume decoding.
    stream.chunks.enqueue(encodeTransportChunk({key:true,timestamp:650000,data:new Uint8Array([1])}));await tick();
    expect(decoder.pending).toHaveLength(1);decoder.drain();await tick();
    expect(tech.getLatestFrame()?.timestamp).toBe(650000);expect(tech.getStats().droppedFrames).toBe(11);
  });
  test.each(['stop','timeout'])('a full startup queue remains bounded and releases on %s',async action=>{
    Decoder.holdOutput=true;tech=new WebTransportTech({maxDecodeQueue:1,startupTimeoutMs:action==='timeout'?100:15000});
    const loading=tech.load(source,{video});const rejected=expect(loading).rejects.toMatchObject({name:action==='timeout'?'TimeoutError':'AbortError'});await tick();
    const stream=Session.instances[0];stream.send();
    for(let i=1;i<=20;i++)stream.chunks.enqueue(encodeTransportChunk({key:i%5===0,timestamp:1000000+i*50000,data:new Uint8Array([1])}));
    await tick();const decoder=Decoder.instances[0];expect(decoder.pending).toHaveLength(1);expect(decoder.reset).not.toHaveBeenCalled();
    if(action==='stop')tech.cancel();await rejected;
    expect(decoder.close).toHaveBeenCalledTimes(1);expect(stream.close).toHaveBeenCalledTimes(1);
    const late={timestamp:1000000,close:jest.fn()};decoder.callbacks.output(late as unknown as VideoFrame);
    expect(late.close).toHaveBeenCalled();expect(draw).not.toHaveBeenCalled();expect(video.srcObject).toBeNull();
  });
  test.each(['config','pause','catchup'])('warmup protection also applies after %s without blocking metadata',async reason=>{
    tech=new WebTransportTech({maxDecodeQueue:2});const metadata=jest.fn();tech.on('metadata',metadata);
    const loading=tech.load(source,{video});await tick();const stream=Session.instances[0];stream.send();await loading;
    Decoder.holdOutput=true;
    if(reason==='config'){stream.chunks.enqueue(encodeTransportConfig(config));await tick();}
    if(reason==='pause'){await tech.pause();await tech.play();}
    const decoder=Decoder.instances[Decoder.instances.length-1];
    if(reason==='catchup')decoder.decodeQueueSize=2;
    stream.chunks.enqueue(encodeTransportChunk({key:true,timestamp:2000000,data:new Uint8Array([1])}));
    for(let i=1;i<=8;i++)stream.chunks.enqueue(encodeTransportChunk({key:false,timestamp:2000000+i*50000,data:new Uint8Array([1])}));
    stream.chunks.enqueue(encodeTransportMetadata({type:'private-data',timestamp:2400000,data:new Uint8Array([255])}));await tick();
    expect(decoder.reset).toHaveBeenCalledTimes(reason==='config'?0:1);
    expect(decoder.pending.map(chunk=>chunk.init.timestamp)).toEqual([2000000,2050000]);
    expect(tech.getStats().droppedFrames).toBe(7);expect(metadata).toHaveBeenCalledTimes(1);
    decoder.drain();await tick();expect(tech.getLatestFrame()?.timestamp).toBe(2050000);
  });
  test('Player uses explicit fallback Sources after unsupported codec; never sends WT URL to MSE',async()=>{
    Decoder.supported=false;
    const player=new FyraPlayer({video,sources:[{...source,fallbacks:[{type:'file',url:'https://example.com/backup.mp4'}]}],plugins:[createWebTransportTechPlugin()],reconnect:{enabled:false}});
    const loading=player.init();while(!Session.instances.length)await tick();Session.instances[0].send();await loading;
    expect(player.getPlaybackSession()?.source).toMatchObject({type:'file',url:'https://example.com/backup.mp4'});
    expect(Session.instances[0].close).toHaveBeenCalledTimes(1);await player.destroy();
  });
  test('emits exact generic metadata before video and queries the same original clock through the application KLV adapter',async()=>{
    const rows=new Map<bigint,number>();
    const service={processLiveData:jest.fn((raw:Uint8Array,pts:bigint)=>{rows.set(pts,raw[0]);}),reset:jest.fn(()=>rows.clear()),destroy:jest.fn(),getInterpolatedStateAtPts:(pts:bigint)=>rows.get(pts) ?? null};
    const integration=createWebTransportKlvIntegration({createService:()=>service});
    const player=new FyraPlayer({video,sources:[source],plugins:integration.plugins,reconnect:{enabled:false}});
    const metadata=jest.fn();player.on('metadata',metadata);
    const loading=player.init();while(!Session.instances.length)await tick();
    expect(integration.getState()).toBeNull();
    const stream=Session.instances[0];stream.chunks.enqueue(encodeTransportConfig(config));
    stream.chunks.enqueue(encodeTransportMetadata({type:'private-data',timestamp:5000017,identifier:300,data:new Uint8Array([42])}));
    stream.chunks.enqueue(encodeTransportChunk({key:true,timestamp:5000017,data:new Uint8Array([1])}));await loading;
    expect(metadata).toHaveBeenCalledWith(expect.objectContaining({type:'private-data',pts:5000.017,timestampUs:5000017,pid:300}));
    expect(metadata.mock.calls[0][0]).not.toHaveProperty('pts90k');
    expect(service.processLiveData).toHaveBeenCalledWith(new Uint8Array([42]),450002n);
    expect(integration.getState()).toBe(42);
    // Config reset invalidates the clock before metadata from the new timeline.
    stream.chunks.enqueue(encodeTransportConfig(config));await tick();expect(integration.getState()).toBeNull();expect(rows.size).toBe(0);
    stream.chunks.enqueue(encodeTransportMetadata({type:'private-data',timestamp:0,data:new Uint8Array([7])}));
    stream.chunks.enqueue(encodeTransportChunk({key:true,timestamp:0,data:new Uint8Array([1])}));await tick();
    expect(integration.getState()).toBe(7);await player.stop();expect(integration.getState()).toBeNull();
    await player.destroy();expect(service.destroy).toHaveBeenCalledTimes(1);
  });
  test('handle clears on config/stop and copied samples cannot mutate the source clock',async()=>{
    const loading=tech.load(source,{video});await tick();Session.instances[0].send();await loading;
    const frame=tech.getLatestFrame()!;frame.timestamp=999;expect(tech.getLatestFrame()?.timestamp).toBe(1000000);
    const previous=frame.timelineId;
    Session.instances[0].chunks.enqueue(encodeTransportConfig(config));await tick();expect(tech.getLatestFrame()).toBeNull();
    Session.instances[0].chunks.enqueue(encodeTransportChunk({key:true,timestamp:0,data:new Uint8Array([1])}));await tick();
    expect(tech.getLatestFrame()!.timelineId).toBeGreaterThan(previous);
    tech.cancel();expect(tech.getLatestFrame()).toBeNull();
  });
  test('metadata observer can synchronously stop without delivering later records in the same read',async()=>{
    const raw=new Uint8Array([3]);const metadata=jest.fn(()=>tech.cancel());tech.on('metadata',metadata);
    const loading=tech.load(source,{video});const rejected=expect(loading).rejects.toMatchObject({name:'AbortError'});await tick();
    const parts=[encodeTransportConfig(config),encodeTransportMetadata({type:'private-data',timestamp:0,data:raw}),encodeTransportChunk({key:true,timestamp:0,data:raw})];
    const joined=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length;}
    Session.instances[0].chunks.enqueue(joined);await rejected;await tick();expect(metadata).toHaveBeenCalledTimes(1);expect(draw).not.toHaveBeenCalled();
  });
  test('a failed handle callback rolls back registration before playback can open a session',async()=>{
    const onPluginError=jest.fn();
    const player=new FyraPlayer({video,sources:[source],onPluginError,reconnect:{enabled:false},plugins:[createWebTransportTechPlugin({onHandle:()=>{throw new Error('handle setup failed');}})]});
    await player.init();await tick();
    expect(onPluginError).toHaveBeenCalledWith(expect.objectContaining({phase:'setup',error:expect.objectContaining({message:'handle setup failed'})}));
    expect(Session.instances).toHaveLength(0);
    expect(player.getPlaybackSession()?.status).not.toBe('loaded');
    await player.destroy();
  });
});
