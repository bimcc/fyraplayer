import { FyraPlayer } from '../src/player.js';
import { createFyraKlvPlugin, type FyraKlvHandle } from '../examples/integrations/fyraklv.js';
import { mockTechInstances, resetMockTechInstances } from './mocks/tech-base.js';

test('KLV integration converts timestamps, maps video time, resets on source switch and releases owned service', async () => {
  resetMockTechInstances();
  const service = {
    processLiveData: jest.fn(), reset: jest.fn(), destroy: jest.fn(),
    getInterpolatedStateAtPts: jest.fn((pts: bigint) => ({ pts }))
  };
  let handle!: FyraKlvHandle<{pts:bigint}>;
  const video = {currentTime:2,load(){},addEventListener(){},removeEventListener(){}} as unknown as HTMLVideoElement;
  const player = new FyraPlayer({video, sources:[{type:'hls',url:'a'},{type:'hls',url:'b'}], plugins:[createFyraKlvPlugin({
    createService:()=>service, mediaTimeToPts:(seconds,source)=> source?.url === 'a' ? 900000n+BigInt(Math.round(seconds*90000)) : null,
    onHandle:value=>{handle=value;}
  })]});
  await player.init();
  service.reset.mockClear();
  const tech=mockTechInstances.hls[0], raw=new Uint8Array([6,14,43,52]);
  tech.emit('metadata',{type:'private-data',raw,pts:1000,pts90k:90001n});
  tech.emit('metadata',{type:'private-data',raw,pts:1001});
  tech.emit('metadata',{type:'sei',raw,pts:1002});
  expect(service.processLiveData.mock.calls).toEqual([[raw,90001n],[raw,90090n]]);
  expect(handle.getState()).toEqual({pts:1080000n});
  await player.seek(1); video.currentTime=1;
  expect(handle.getState()).toEqual({pts:990000n});
  expect(service.reset).not.toHaveBeenCalled();
  tech.emit('streamchange', { reason: 'discontinuity' });
  expect(service.reset).toHaveBeenCalledTimes(1);
  service.reset.mockClear();
  await player.switchSource(1); expect(service.reset).toHaveBeenCalledTimes(2); // invalidate + select
  expect(handle.getState()).toBeNull();
  await player.destroy();
  tech.emit('metadata',{type:'private-data',raw,pts:1003});
  expect(service.processLiveData).toHaveBeenCalledTimes(2);
  expect(service.destroy).toHaveBeenCalledTimes(1);
  expect(handle.getStateAtPts(90000n)).toBeNull();
});

test('KLV integration can use the displayed frame clock and waits while the clock has no sample', () => {
  let handle!: FyraKlvHandle<bigint>;
  let mediaTime: number | null = null;
  const service = { processLiveData() {}, reset() {}, destroy: jest.fn(), getInterpolatedStateAtPts: (pts: bigint) => pts };
  const player = { currentTime: 99, getCurrentSource: () => undefined, on() {}, off() {} };
  const plugin = createFyraKlvPlugin({ createService: () => service,
    getMediaTime: () => mediaTime,
    mediaTimeToPts: seconds => 900000n + BigInt(Math.round(seconds * 90000)),
    onHandle: value => { handle = value; }
  })({ player } as unknown as import('../src/types.js').PluginContext)!;
  expect(handle.getState()).toBeNull();
  mediaTime = 2.5;
  expect(handle.getState()).toBe(1125000n);
  mediaTime = NaN;
  expect(handle.getState()).toBeNull();
  plugin.destroy!(); plugin.destroy!();
  expect(service.destroy).toHaveBeenCalledTimes(1);
});

test('KLV maps against actual fallback source and resets the application anchor on a timeline change', async () => {
  resetMockTechInstances();
  let anchor: bigint | null = null;
  const reset = jest.fn(() => { anchor = null; });
  const service = { processLiveData() {}, reset: jest.fn(), destroy() {}, getInterpolatedStateAtPts: (pts: bigint) => pts };
  const map = jest.fn((seconds: number, source: import('../src/types.js').Source | undefined) =>
    anchor !== null && source?.url === 'b' ? anchor + BigInt(Math.round(seconds * 90000)) : null);
  let handle!: FyraKlvHandle<bigint>;
  const video = { currentTime: 1, load() {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLVideoElement;
  const player = new FyraPlayer({ video, sources: [{ type: 'hls', url: 'a', fallbacks: [{ type: 'hls', url: 'b' }] }],
    plugins: [createFyraKlvPlugin({ createService: () => service, mediaTimeToPts: map, onTimelineReset: reset, onHandle: h => { handle = h; } })] });
  jest.spyOn(mockTechInstances.hls[0], 'load').mockImplementation(async source => { if (source.url === 'a') throw new Error('unavailable'); });
  await player.init();
  anchor = 900000n;
  expect(handle.getState()).toBe(990000n);
  expect(map).toHaveBeenLastCalledWith(1, expect.objectContaining({ url: 'b' }), expect.objectContaining({ status: 'loaded' }));
  mockTechInstances.hls[0].emit('streamchange', { reason: 'discontinuity' });
  expect(anchor).toBeNull();
  expect(handle.getState()).toBeNull();
  await player.destroy();
});
