import { FileTech } from '../src/techs/tech-file.js';
import { MseFallback } from '../src/techs/wsRaw/mseFallback.js';
import type { FileSource } from '../src/types.js';

function video() {
  return {src:'',srcObject:null,currentTime:0,paused:true,load:jest.fn(),play:jest.fn(async()=>{}),pause:jest.fn()} as unknown as HTMLVideoElement;
}
function mpegts(supported=true) {
  const listeners = new Map<string,(error?:unknown)=>void>();
  const player = {attachMediaElement:jest.fn(),load:jest.fn(),play:jest.fn(async()=>{}),pause:jest.fn(),unload:jest.fn(),detachMediaElement:jest.fn(),destroy:jest.fn(),on:jest.fn((event:string,fn:(error?:unknown)=>void)=>listeners.set(event,fn))};
  const module={isSupported:()=>supported,createPlayer:jest.fn(()=>player),Events:{ERROR:'error',LOADING_COMPLETE:'complete'}};
  return {player,module,listeners};
}

test('native file supports play/pause/seek and clears the media element at teardown', async()=>{
  const tech=new FileTech(),v=video(),ready=jest.fn();tech.on('ready',ready);
  await tech.load({type:'file',url:'movie.mp4'},{video:v});
  expect(v.src).toBe('movie.mp4');expect(ready).toHaveBeenCalledTimes(1);
  await tech.play();await tech.pause();await tech.seek(12.5);
  expect(v.play).toHaveBeenCalled();expect(v.pause).toHaveBeenCalled();expect(v.currentTime).toBe(12.5);
  await tech.destroy();expect(v.src).toBe('');expect(v.srcObject).toBeNull();
});

test.each<[FileSource,string]>([
  [{type:'file',url:'movie.mts'},'mpegts'],
  [{type:'file',url:'movie.flv?token=sample'},'flv'],
  [{type:'file',url:'blob:local-file',container:'flv'},'flv']
])('container %j uses the optional mpegts loader',async(source,format)=>{
  const tech=new FileTech(),m=mpegts(),v=video();
  await tech.load(source,{video:v,mpegtsLoader:async()=>m.module});
  expect(m.module.createPlayer).toHaveBeenCalledWith({type:format,url:source.url,isLive:false},expect.any(Object));
  await tech.seek(4);expect(v.currentTime).toBe(4);
  await tech.destroy();expect(m.player.unload).toHaveBeenCalled();expect(m.player.destroy).toHaveBeenCalledTimes(1);
});

test('real MSE adapter registers events before load/play and tears down its player',async()=>{
  const fallback=new MseFallback(),m=mpegts(),ready=jest.fn(),error=jest.fn();
  m.player.load.mockImplementation(()=>m.listeners.get('complete')?.());
  await fallback.start('live.ts',video(),{onReady:ready,onError:error},'mpegts',async()=>m.module);
  expect(ready).toHaveBeenCalledTimes(1);
  m.listeners.get('error')?.('network');expect(error).toHaveBeenCalledWith('network');
  fallback.stop();fallback.stop();expect(m.player.destroy).toHaveBeenCalledTimes(1);
});

test('MSE unsupported rejects loading and rejected playback reports a runtime error',async()=>{
  const fallback=new MseFallback(),unsupported=mpegts(false);
  await expect(fallback.start('a.flv',video(),{},'flv',async()=>unsupported.module)).rejects.toThrow('not supported');
  expect(unsupported.module.createPlayer).not.toHaveBeenCalled();
  const m=mpegts();m.player.play.mockRejectedValueOnce(Error('play rejected'));
  const onError = jest.fn();
  await fallback.start('a.flv',video(),{onError},'flv',async()=>m.module);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({message:'play rejected'}));
  fallback.stop();expect(m.player.destroy).toHaveBeenCalledTimes(1);
});

test('MSE can stop while play is pending and suppresses late callbacks', async () => {
  const fallback = new MseFallback(), m = mpegts(), onError = jest.fn();
  let rejectPlay!: (reason: Error) => void;
  m.player.play.mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectPlay = reject; }));
  await fallback.start('live.flv', video(), {onError}, 'flv', async () => m.module);
  m.player.pause.mockImplementation(() => { throw new Error('already detached'); });
  fallback.stop();
  rejectPlay(new Error('aborted'));
  await Promise.resolve();
  m.listeners.get('error')?.('late network');
  expect(onError).not.toHaveBeenCalled();
  expect(m.player.destroy).toHaveBeenCalledTimes(1);
});

test('MSE stop invalidates a pending module loader', async () => {
  const fallback = new MseFallback(), m = mpegts();
  let release!: (value: typeof m.module) => void;
  const started = fallback.start('live.flv', video(), {}, 'flv', () => new Promise(resolve => { release = resolve; }));
  fallback.stop();
  release(m.module);
  await started;
  expect(m.module.createPlayer).not.toHaveBeenCalled();
});

test('File cancels a hanging mpegts loader and never creates a late player', async () => {
  const tech = new FileTech(), m = mpegts(), controller = new AbortController();
  let release!: (value: typeof m.module) => void;
  const loading = tech.load({ type: 'file', url: 'movie.ts' }, { video: video(), signal: controller.signal,
    mpegtsLoader: () => new Promise(resolve => { release = resolve; }) });
  controller.abort();
  await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
  await tech.destroy();
  release(m.module); await Promise.resolve(); await Promise.resolve();
  expect(m.module.createPlayer).not.toHaveBeenCalled();
});
