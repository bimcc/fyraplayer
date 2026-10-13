import { FyraPlayer } from '../src/player.js';
import { mockTechInstances, resetMockTechInstances } from './mocks/tech-base.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function video(): HTMLVideoElement {
  return { currentTime: 0, paused: true, readyState: 0, load() {}, addEventListener() {}, removeEventListener() {} } as unknown as HTMLVideoElement;
}
function createPlayer() {
  return new FyraPlayer({ video: video(), sources: ['A', 'B', 'C'].map(url => ({ type: 'hls', url })), reconnect: { enabled: false } });
}

describe('in-flight player lifecycle', () => {
  beforeEach(() => { resetMockTechInstances(); jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  test('inline playback defaults on and can be explicitly disabled', async () => {
    const inline = createPlayer(); expect(inline.getVideoElement().playsInline).toBe(true); await inline.destroy();
    const native = new FyraPlayer({video:video(),sources:[],playsInline:false});
    expect(native.getVideoElement().playsInline).toBe(false); await native.destroy();
  });

  test('browser playback policy prompts for a tap without errors or transport recovery', async () => {
    const element = video(); element.play = jest.fn().mockResolvedValue(undefined);
    const player = new FyraPlayer({video:element,sources:[{type:'hls',url:'A'}]});
    const tech = mockTechInstances.hls[0]; tech.emitReadyDuringLoad = true;
    const network = jest.fn(), error = jest.fn(); player.on('network',network); player.on('error',error);
    await player.init();
    jest.spyOn(tech,'play').mockRejectedValueOnce(new DOMException('User gesture required','NotAllowedError')).mockResolvedValue(undefined);
    await player.play();
    expect(network).toHaveBeenCalledWith(expect.objectContaining({code:'AUTOPLAY_BLOCKED',severity:'warning'}));
    expect(error).not.toHaveBeenCalled(); expect(player.getState()).toBe('paused');
    jest.advanceTimersByTime(10000); expect(tech.loadCalls).toBe(1);
    await player.play(); expect(tech.play).toHaveBeenCalledTimes(2); expect(tech.loadCalls).toBe(1);
    await player.destroy();
  });

  test('joins concurrent init, serializes loads and selects the latest requested source', async () => {
    const player = createPlayer();
    const tech = mockTechInstances.hls[0];
    const started = deferred(), release = deferred();
    const loaded: string[] = [];
    jest.spyOn(tech, 'load').mockImplementation(async source => {
      loaded.push(source.url);
      if (source.url === 'A') { started.resolve(); await release.promise; }
      tech.emit('ready');
    });
    const ready = jest.fn(); player.on('ready', ready);
    const init = player.init(), duplicateInit = player.init();
    await started.promise;
    const b = player.switchSource(1), c = player.switchSource(2);
    release.resolve();
    await Promise.all([init, duplicateInit, b, c]);
    expect(loaded).toEqual(['A', 'C']);
    expect(player.getCurrentSource()?.url).toBe('C');
    expect(player.getState()).toBe('ready');
    expect(ready).toHaveBeenCalledTimes(1);
    await player.destroy();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('destroy suppresses late ready/errors and timers, waits for final Tech cleanup', async () => {
    const player = createPlayer(); const tech = mockTechInstances.hls[0];
    const started = deferred(), release = deferred();
    jest.spyOn(tech, 'load').mockImplementation(async () => { started.resolve(); await release.promise; tech.emit('ready'); });
    const ready = jest.fn(); player.on('ready', ready);
    const init = player.init(); await started.promise;
    const destroy = player.destroy();
    expect(player.destroy()).toBe(destroy);
    release.resolve(); await Promise.all([init, destroy]);
    expect(ready).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(tech.destroyCalls).toBe(1);
    expect(player.getState()).toBe('idle');
    await expect(player.init()).rejects.toThrow('destroyed');
    await expect(player.switchSource(1)).rejects.toThrow('destroyed');
  });

  test('source switch invalidates pending middleware before it reaches a Tech', async () => {
    const started = deferred(), release = deferred();
    const player = new FyraPlayer({ video: video(), sources: [{type:'hls',url:'A'},{type:'hls',url:'B'}], middleware: [{kind:'request', fn: async ctx => {
      if (ctx.url === 'A') { started.resolve(); await release.promise; }
    }}] });
    const init = player.init(); await started.promise;
    const switched = player.switchSource(1); release.resolve();
    await Promise.all([init, switched]);
    expect(mockTechInstances.hls[0].loadCalls).toBe(1);
    expect(mockTechInstances.hls[0].lastLoadedSource?.url).toBe('B');
    await player.destroy();
  });

  test('a rejected request middleware reports failure and does not wedge subsequent loads', async () => {
    const player = new FyraPlayer({ video: video(), reconnect: {enabled:false}, sources: [{type:'hls',url:'A'},{type:'hls',url:'B'}], middleware:[{kind:'request', fn:ctx=>{if(ctx.url==='A') throw Error('signing failed');}}] });
    const error = jest.fn(); player.on('error', error);
    await player.init(); expect(player.getState()).toBe('error');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({message:'signing failed'}));
    await player.switchSource(1);
    expect(mockTechInstances.hls[0].lastLoadedSource?.url).toBe('B');
    await player.destroy();
  });

  test('reentrant source changes queue only the last requested source', async () => {
    const player = createPlayer();
    let nested: Promise<void> | undefined;
    player.on('sourcechange', event => {
      if (event.index === 1) nested = player.switchSource(2);
    });
    await player.switchSource(1);
    await nested;
    const tech = mockTechInstances.hls[0];
    expect(tech.loadCalls).toBe(1);
    expect(tech.lastLoadedSource?.url).toBe('C');
    await player.destroy();
  });

  test.each(['pause', 'seek', 'play'] as const)('pending %s middleware cannot control a destroyed player', async action => {
    const started = deferred();
    const release = deferred();
    const player = new FyraPlayer({
      video: video(), sources: [{ type: 'hls', url: 'A' }],
      middleware: [{ kind: 'control', fn: async () => { started.resolve(); await release.promise; } }]
    });
    const tech = mockTechInstances.hls[0];
    jest.spyOn(tech, 'load').mockImplementation(async () => { tech.emit('ready'); });
    await player.init();
    const called = jest.spyOn(tech, action);
    const controlled = action === 'seek' ? player.seek(12) : player[action]();
    await started.promise;
    await player.destroy();
    release.resolve();
    await controlled;
    expect(called).not.toHaveBeenCalled();
    expect(player.getState()).toBe('idle');
    expect(jest.getTimerCount()).toBe(0);
  });

  test('storage is optional and safely read only when a plugin requests it', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const getter = jest.fn(() => { throw new DOMException('denied', 'SecurityError'); });
    Object.defineProperty(globalThis, 'localStorage', { configurable:true, get:getter });
    try {
      const plain = createPlayer(); expect(getter).not.toHaveBeenCalled(); await plain.destroy();
      const player = new FyraPlayer({video:video(),sources:[],plugins:[ctx=>{expect(ctx.storage).toBeUndefined();}]});
      expect(getter).toHaveBeenCalled(); await player.destroy();
    } finally {
      if(original) Object.defineProperty(globalThis,'localStorage',original);
      else Reflect.deleteProperty(globalThis,'localStorage');
    }
  });

  test('destroy inside a reconnect callback cannot install a new timer', async () => {
    const player = new FyraPlayer({ video: video(), sources: [{ type: 'hls', url: 'A' }] });
    let destroyed: Promise<void> | undefined;
    player.on('network', event => {
      if (event?.type === 'reconnect') destroyed = player.destroy();
    });
    await player.init();
    mockTechInstances.hls[0].emit('network', { type: 'disconnected', fatal: true });
    expect(destroyed).toBeDefined();
    await destroyed;
    expect(jest.getTimerCount()).toBe(0);
    expect(player.getState()).toBe('idle');
  });

  test('stop cancels a pending play load immediately without playing after it settles', async () => {
    const element = video();
    const nativePlay = jest.fn(); element.play = nativePlay;
    const player = new FyraPlayer({ video: element, sources: [{ type: 'hls', url: 'A' }] });
    const started = deferred();
    const tech = mockTechInstances.hls[0];
    let signal: AbortSignal | undefined;
    jest.spyOn(tech, 'load').mockImplementation(async (_source, options) => {
      signal = options?.signal; started.resolve();
      await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
      tech.emit('ready');
    });
    const ready = jest.fn(); player.on('ready', ready);
    const play = player.play(); await started.promise;
    const stopped = player.stop();
    expect(player.stop()).toBe(stopped);
    expect(signal?.aborted).toBe(true);
    expect(player.getState()).toBe('idle');
    expect(player.getPlaybackSession()).toBeNull();
    await Promise.all([play, stopped]);
    expect(tech.playCalls).toBe(0); expect(nativePlay).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled(); expect(tech.destroyCalls).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
    await player.destroy();
  });

  test('stop releases resources, keeps plugins, and permits playback on the same instance', async () => {
    const cleanup = jest.fn(); const stopped = jest.fn();
    const element = video(); element.play = jest.fn().mockResolvedValue(undefined);
    const player = new FyraPlayer({video:element,sources:[{type:'hls',url:'A'}],plugins:[() => ({destroy:cleanup})]});
    const tech = mockTechInstances.hls[0]; tech.emitReadyDuringLoad = true;
    player.on('stop', stopped);
    await player.init(); const oldEpoch = player.getPlaybackSession()!.epoch;
    await player.stop();
    expect(stopped).toHaveBeenCalledTimes(1); expect(cleanup).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    await player.play();
    expect(tech.loadCalls).toBe(2); expect(tech.playCalls).toBe(1);
    expect(player.getPlaybackSession()!.epoch).toBeGreaterThan(oldEpoch);
    await player.destroy(); expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('pause cancels scheduled recovery and ignores events from the stopped Tech', async () => {
    const player = new FyraPlayer({video:video(),sources:[{type:'hls',url:'A'}],reconnect:{enabled:true,baseDelayMs:100}});
    const tech = mockTechInstances.hls[0]; tech.emitReadyDuringLoad = true;
    await player.init();
    tech.emit('network', {type:'disconnected',fatal:true});
    expect(jest.getTimerCount()).toBeGreaterThan(1);
    await player.pause();
    tech.emit('ready'); tech.emit('network', {type:'disconnected',fatal:true});
    jest.advanceTimersByTime(10000);
    expect(tech.loadCalls).toBe(1); expect(player.getState()).toBe('idle');
    expect(jest.getTimerCount()).toBe(0);
    await player.destroy();
  });

  test('stop during uncooperative load invalidates it and safely queues an immediate switch', async () => {
    const player = createPlayer(); const tech = mockTechInstances.hls[0];
    const started = deferred(), release = deferred(); const sources: string[] = [];
    jest.spyOn(tech, 'load').mockImplementation(async source => {
      sources.push(source.url);
      if(source.url === 'A') {started.resolve(); await release.promise;}
      tech.emit('ready');
    });
    const init = player.init(); await started.promise;
    const stop = player.stop();
    expect(player.getPlaybackSession()).toBeNull();
    const switched = player.switchSource(1);
    expect(sources).toEqual(['A']);
    release.resolve(); await Promise.all([init,stop,switched]);
    expect(sources).toEqual(['A','B']); expect(tech.destroyCalls).toBe(1);
    expect(player.getState()).toBe('ready'); expect(player.getPlaybackSession()?.source.url).toBe('B');
    await player.destroy();
  });

  test('stop in a reconnect callback prevents a new recovery timer', async () => {
    const player = new FyraPlayer({video:video(),sources:[{type:'hls',url:'A'}]});
    let stopped: Promise<void> | undefined;
    player.on('network', event => {if(event?.type === 'reconnect') stopped = player.stop();});
    await player.init(); mockTechInstances.hls[0].emit('network',{type:'disconnected',fatal:true});
    await stopped; expect(jest.getTimerCount()).toBe(0); expect(player.getState()).toBe('idle');
    await player.destroy();
  });

  test('play waiting on control middleware cannot restart after stop followed by a new load', async () => {
    const started = deferred(), release = deferred();
    const player = new FyraPlayer({video:video(),sources:[{type:'hls',url:'A'},{type:'hls',url:'B'}],middleware:[{kind:'control',fn:async()=>{started.resolve();await release.promise;}}]});
    const tech = mockTechInstances.hls[0]; tech.emitReadyDuringLoad = true;
    await player.init(); const play = player.play(); await started.promise;
    const stop = player.stop(); const switched = player.switchSource(1);
    await Promise.all([stop,switched]); release.resolve(); await play;
    expect(tech.playCalls).toBe(0); expect(player.getPlaybackSession()?.source.url).toBe('B');
    await player.destroy();
  });

  test('stop abort observers can request a new source without old stop events overwriting it', async () => {
    const player = createPlayer(); const tech = mockTechInstances.hls[0]; const started = deferred();
    let switched: Promise<void> | undefined;
    const stops = jest.fn(); player.on('stop', stops);
    jest.spyOn(tech, 'load').mockImplementation(async (source, options) => {
      if (source.url === 'A') {
        started.resolve();
        await new Promise<void>(resolve => options!.signal!.addEventListener('abort', () => {
          switched = player.switchSource(1); resolve();
        }, {once:true}));
      }
      tech.emit('ready');
    });
    const init = player.init(); await started.promise;
    const stop = player.stop(); await Promise.all([init,stop,switched]);
    expect(stops).not.toHaveBeenCalled();
    expect(player.getState()).toBe('ready'); expect(player.getPlaybackSession()?.source.url).toBe('B');
    await player.destroy();
  });

  test('a play load stopped and replaced from a session observer cannot play the replacement', async () => {
    const element = video(); element.play = jest.fn().mockResolvedValue(undefined);
    const player = new FyraPlayer({video:element,sources:[{type:'hls',url:'A'},{type:'hls',url:'B'}]});
    const tech = mockTechInstances.hls[0]; tech.emitReadyDuringLoad = true;
    let stop: Promise<void> | undefined, switched: Promise<void> | undefined;
    player.on('sessionchange', event => {
      if(event.reason === 'load') {stop = player.stop(); switched = player.switchSource(1);}
    });
    await player.play(); await Promise.all([stop,switched]);
    expect(tech.playCalls).toBe(0); expect(element.play).not.toHaveBeenCalled();
    expect(player.getPlaybackSession()?.source.url).toBe('B');
    await player.destroy();
  });
});
