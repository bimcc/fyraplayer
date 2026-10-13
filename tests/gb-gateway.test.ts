import {createGbGatewayAdapter} from '../src/plugins/gb-gateway.js';
import {FyraPlayer} from '../src/player.js';
import {mockTechInstances,resetMockTechInstances} from './mocks/tech-base.js';
import type {GbGatewaySession} from '../src/plugins/gb-gateway.js';
const video=()=>({paused:true,readyState:0,load(){},addEventListener(){},removeEventListener(){}} as unknown as HTMLVideoElement);
const session=():GbGatewaySession=>({id:'server-session',source:{type:'hls',url:'converted.m3u8'},fallbacks:[{type:'file',url:'fallback.mp4'}]});
describe('optional GB gateway control plane',()=>{
  beforeEach(resetMockTechInstances);
  test('resolves standard Source and actual session while retaining requested source; stop releases exactly once',async()=>{
    const release=jest.fn(),control=jest.fn().mockResolvedValue('accepted');
    const gateway=createGbGatewayAdapter({invite:async()=>session(),release,control});
    const player=new FyraPlayer({video:video(),sources:[{type:'auto',engine:'gb-gateway',url:'channel-1'}],middleware:[gateway.middleware],plugins:[gateway.plugin],reconnect:{enabled:false}});
    await player.init();
    expect(player.getCurrentSource()?.type).toBe('auto');
    expect(player.getPlaybackSession()?.source).toMatchObject({type:'hls',url:'converted.m3u8'});
    expect(gateway.getSession()?.id).toBe('server-session');
    await expect(gateway.control('ptz',{direction:'left'})).resolves.toBe('accepted');
    await player.stop();await player.destroy();
    expect(release).toHaveBeenCalledTimes(1);expect(release).toHaveBeenCalledWith(expect.objectContaining({id:'server-session'}),'stop');
    expect(gateway.getSession()).toBeNull();
  });
  test('failed primary media attempt preserves gateway session for its concrete fallback',async()=>{
    const release=jest.fn();const gateway=createGbGatewayAdapter({invite:async()=>session(),release});
    const player=new FyraPlayer({video:video(),sources:[{type:'auto',engine:'gb-gateway',url:'channel'}],middleware:[gateway.middleware],plugins:[gateway.plugin],reconnect:{enabled:false}});
    jest.spyOn(mockTechInstances.hls[0],'load').mockRejectedValue(new Error('Unavailable'));
    await player.init();
    expect(player.getPlaybackSession()?.source.type).toBe('file');expect(gateway.getSession()).not.toBeNull();expect(release).not.toHaveBeenCalled();
    await player.destroy();expect(release).toHaveBeenCalledTimes(1);
  });
  test('cancelled invite unblocks stop and releases a backend session that arrives late',async()=>{
    let resolve!: (value:GbGatewaySession)=>void;
    const release=jest.fn(),invite=jest.fn(()=>new Promise<GbGatewaySession>(r=>{resolve=r;}));
    const gateway=createGbGatewayAdapter({invite,release});
    const player=new FyraPlayer({video:video(),sources:[{type:'auto',engine:'gb-gateway',url:'channel'}],middleware:[gateway.middleware],plugins:[gateway.plugin],reconnect:{enabled:false}});
    const init=player.init();while(!invite.mock.calls.length) await Promise.resolve();
    await player.stop();await init;
    resolve(session());await new Promise(r=>setTimeout(r,0));
    expect(release).toHaveBeenCalledWith(expect.anything(),'cancelled');expect(mockTechInstances.hls[0].loadCalls).toBe(0);
    await player.destroy();expect(release).toHaveBeenCalledTimes(1);
  });
  test('aborts outstanding controls immediately when the player stops',async()=>{
    const gateway=createGbGatewayAdapter({invite:async()=>session(),control:()=>new Promise(()=>{})});
    const player=new FyraPlayer({video:video(),sources:[{type:'auto',engine:'gb-gateway',url:'channel'}],middleware:[gateway.middleware],plugins:[gateway.plugin],reconnect:{enabled:false}});
    await player.init();const control=gateway.control('ptz');const rejected=expect(control).rejects.toMatchObject({name:'AbortError'});
    await player.stop();await rejected;await player.destroy();
  });
  test('final startup failure releases the gateway and invalidates controls',async()=>{
    const release=jest.fn();const gateway=createGbGatewayAdapter({invite:async()=>({id:'failed',source:{type:'hls',url:'bad.m3u8'}}),release});
    const player=new FyraPlayer({video:video(),sources:[{type:'auto',engine:'gb-gateway',url:'channel'}],middleware:[gateway.middleware],plugins:[gateway.plugin],reconnect:{enabled:false}});
    jest.spyOn(mockTechInstances.hls[0],'load').mockRejectedValue(new Error('Unavailable'));
    await player.init();await Promise.resolve();expect(player.getState()).toBe('error');
    expect(gateway.getSession()).toBeNull();expect(release).toHaveBeenCalledWith(expect.objectContaining({id:'failed'}),'failed');
    await player.destroy();expect(release).toHaveBeenCalledTimes(1);
  });
  test('a primary Tech error followed by load rejection must keep the gateway for its fallback',async()=>{
    const release=jest.fn();const gateway=createGbGatewayAdapter({invite:async()=>session(),release});
    const player=new FyraPlayer({video:video(),sources:[{type:'auto',engine:'gb-gateway',url:'channel'}],middleware:[gateway.middleware],plugins:[gateway.plugin],reconnect:{enabled:false}});
    jest.spyOn(mockTechInstances.hls[0],'load').mockImplementation(async()=>{
      mockTechInstances.hls[0].emit('error',new Error('Startup error'));
      throw new Error('Unavailable');
    });
    await player.init();expect(player.getPlaybackSession()?.source.type).toBe('file');
    expect(gateway.getSession()).not.toBeNull();expect(release).not.toHaveBeenCalled();
    await player.destroy();expect(release).toHaveBeenCalledTimes(1);
  });
  test('rejects recursive gateway Sources nested inside backend fallbacks',async()=>{
    const release=jest.fn();const gateway=createGbGatewayAdapter({invite:async()=>({id:'recursive',source:{type:'hls',url:'stream.m3u8',fallbacks:[{type:'auto',engine:'gb-gateway',url:'same'}]}}),release});
    const player=new FyraPlayer({video:video(),sources:[{type:'auto',engine:'gb-gateway',url:'channel'}],middleware:[gateway.middleware],plugins:[gateway.plugin],reconnect:{enabled:false}});
    const errors=jest.fn();player.on('error',errors);await player.init();
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining('concrete browser')}));
    expect(release).toHaveBeenCalledWith(expect.anything(),'failed');expect(mockTechInstances.hls[0].loadCalls).toBe(0);await player.destroy();
  });
  test('reconnect exhaustion releases the backend after the active media session is cleared',async()=>{
    const release=jest.fn();const gateway=createGbGatewayAdapter({invite:async()=>session(),release});
    const player=new FyraPlayer({video:video(),sources:[{type:'auto',engine:'gb-gateway',url:'channel'}],middleware:[gateway.middleware],plugins:[gateway.plugin],reconnect:{enabled:true,maxRetries:0}});
    await player.init();mockTechInstances.hls[0].emit('network',{type:'closed',fatal:true});
    await new Promise(r=>setTimeout(r,0));
    expect(gateway.getSession()).toBeNull();expect(release).toHaveBeenCalledWith(expect.anything(),'failed');
    await player.destroy();expect(release).toHaveBeenCalledTimes(1);
  });
});
