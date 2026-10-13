import { createMetadataPlugin, MetadataBridge, KlvBridge } from '../src/plugins/metadata/index.js';
import type { MetadataEvent, PluginContext } from '../src/types.js';
import { PluginManager } from '../src/core/pluginManager.js';

type Handler = (event: unknown) => void;

test('legacy bridge alias and teardown suppress late async parser results', async () => {
  expect(KlvBridge).toBe(MetadataBridge);
  let resolve!: (value: number) => void;
  const onData = jest.fn();
  const bridge = new MetadataBridge({parse:()=>new Promise<number>(r=>{resolve=r;}),onData});
  const pending = bridge.handle({type:'private-data',raw:new Uint8Array(),pts:0});
  bridge.destroy(); resolve(1); await pending;
  expect(onData).not.toHaveBeenCalled();
});

class PlayerStub {
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload: unknown): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}

function createContext(player: PlayerStub): PluginContext {
  return {
    player: player as unknown as PluginContext['player'],
    coreBus: {} as PluginContext['coreBus'],
    techs: {} as PluginContext['techs'],
    storage: null
  };
}

describe('createMetadataPlugin', () => {
  test('source replacement suppresses late parse results and failures while allowing the new timeline',async()=>{
    const player=new PlayerStub();let resolve!:(value:number)=>void;let reject!:(error:unknown)=>void;
    const parse=jest.fn().mockImplementationOnce(()=>new Promise<number>(r=>{resolve=r;})).mockImplementationOnce(()=>new Promise((_r,j)=>{reject=j;})).mockResolvedValue(3);
    const onData=jest.fn(),onError=jest.fn();createMetadataPlugin({parse,onData,onError})(createContext(player));
    const event:MetadataEvent={type:'private-data',raw:new Uint8Array([1]),pts:0};
    player.emit('metadata',event);player.emit('metadata',event);player.emit('sourcechange',{});
    resolve(1);reject(new Error('old error'));await Promise.resolve();expect(onData).not.toHaveBeenCalled();expect(onError).not.toHaveBeenCalled();
    player.emit('metadata',event);await Promise.resolve();expect(onData).toHaveBeenCalledWith(3,event);
  });
  test('new session epochs suppress old results; loaded in the same epoch preserves current work',async()=>{
    const player=new PlayerStub();let epoch=1;Object.assign(player,{getPlaybackSession:()=>({epoch})});
    const resolvers:Array<(value:number)=>void>=[];const parse=jest.fn(()=>new Promise<number>(r=>resolvers.push(r))),onData=jest.fn();
    const life=createMetadataPlugin({parse,onData})(createContext(player));
    const event:MetadataEvent={type:'private-data',raw:new Uint8Array(),pts:0};player.emit('metadata',event);
    epoch=2;player.emit('sessionchange',{epoch,reason:'discontinuity'});resolvers[0](1);await Promise.resolve();expect(onData).not.toHaveBeenCalled();
    player.emit('metadata',event);player.emit('sessionchange',{epoch,reason:'loaded'});resolvers[1](2);await Promise.resolve();expect(onData).toHaveBeenCalledWith(2,event);
    await life?.destroy?.();
  });
  test('scope abort suppresses pending parse results before final teardown', async () => {
    const player = new PlayerStub();
    const manager = new PluginManager();
    let resolve!: (value: number) => void;
    const parse = jest.fn(() => new Promise<number>(done => { resolve = done; }));
    const onData = jest.fn();
    manager.register(createMetadataPlugin({ parse, onData }));
    manager.applyAll(createContext(player));
    const event: MetadataEvent = { type: 'private-data', raw: new Uint8Array([1]), pts: 1 };
    player.emit('metadata', event);
    manager.deactivateAll();
    resolve(1);
    await Promise.resolve();
    player.emit('metadata', event);
    expect(onData).not.toHaveBeenCalled();
    expect(parse).toHaveBeenCalledTimes(1);
    await manager.unregisterAll();
  });

  test('parses raw metadata events and detaches on destroy', async () => {
    const player = new PlayerStub();
    const parse = jest.fn((event: MetadataEvent) => ({ pts: event.pts, bytes: event.raw.byteLength }));
    const onData = jest.fn();
    const onError = jest.fn();

    const plugin = createMetadataPlugin({ parse, onData, onError });
    const lifecycle = plugin(createContext(player));

    const rawEvent: MetadataEvent = {
      type: 'private-data',
      raw: new Uint8Array([1, 2, 3]),
      pts: 123,
      pid: 256
    };

    player.emit('metadata', rawEvent);
    await Promise.resolve();

    expect(parse).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith({ pts: 123, bytes: 3 }, rawEvent);
    expect(onError).not.toHaveBeenCalled();

    lifecycle?.destroy?.();
    player.emit('metadata', { ...rawEvent, pts: 456 });
    await Promise.resolve();

    expect(parse).toHaveBeenCalledTimes(1);
  });

  test('does not send detect-only events to raw parsers by default', async () => {
    const player = new PlayerStub();
    const parse = jest.fn();
    const onData = jest.fn();
    const onError = jest.fn();

    const plugin = createMetadataPlugin({ parse, onData, onError });
    plugin(createContext(player));

    player.emit('metadata', { type: 'private-data-detected', pids: [256] });
    await Promise.resolve();

    expect(parse).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  test('can route detect-only events to onDetected', async () => {
    const player = new PlayerStub();
    const parse = jest.fn();
    const onData = jest.fn();
    const onDetected = jest.fn();

    const plugin = createMetadataPlugin({ parse, onData, onDetected });
    plugin(createContext(player));

    const detected = { type: 'private-data-detected', pids: [256] };
    player.emit('metadata', detected);
    await Promise.resolve();

    expect(parse).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(onDetected).toHaveBeenCalledWith(detected);
  });

  test('reports parser errors through onError', async () => {
    const player = new PlayerStub();
    const thrown = new Error('parse failed');
    const parse = jest.fn(() => {
      throw thrown;
    });
    const onData = jest.fn();
    const onError = jest.fn();
    const rawEvent: MetadataEvent = { type: 'sei', raw: new Uint8Array([5]), pts: 1, seiType: 5 };

    const plugin = createMetadataPlugin({ parse, onData, onError });
    plugin(createContext(player));

    player.emit('metadata', rawEvent);
    await Promise.resolve();

    expect(onData).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(thrown, rawEvent);
  });
});
