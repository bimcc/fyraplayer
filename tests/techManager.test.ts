import { EventBus } from '../src/core/eventBus.js';
import { TechManager } from '../src/core/techManager.js';
import type { Source, Tech } from '../src/types.js';

function createMockTech(args: {
  canPlay?: (source: Source) => boolean;
  loadImpl?: (source: Source) => Promise<void>;
} = {}): Tech {
  const canPlay = args.canPlay ?? (() => true);
  const loadImpl = args.loadImpl ?? (async () => {});
  return {
    canPlay,
    async load(source) {
      await loadImpl(source);
    },
    async play() {},
    async pause() {},
    async seek() {},
    async destroy() {},
    getStats() {
      return { ts: Date.now() };
    },
    on() {}
  };
}

describe('TechManager', () => {
  test('selects the first playable tech in order', async () => {
    const manager = new TechManager(new EventBus());
    manager.register('webrtc', createMockTech({ canPlay: () => false }));
    manager.register('hls', createMockTech({ canPlay: (source) => source.type === 'hls' }));

    const source: Source = { type: 'hls', url: 'https://example.com/live.m3u8' };
    const result = await manager.selectAndLoad([source], ['webrtc', 'hls'], {
      video: {} as HTMLVideoElement
    });

    expect(result).toEqual({ source, tech: 'hls' });
    expect(manager.getCurrentTechName()).toBe('hls');
  });

  test('marks failed tech and falls back to next tech', async () => {
    const manager = new TechManager(new EventBus());
    const webrtc = createMockTech({
      canPlay: () => true,
      loadImpl: async () => {
        throw new Error('webrtc load failed');
      }
    });
    const hls = createMockTech({ canPlay: (source) => source.type === 'hls' });
    manager.register('webrtc', webrtc);
    manager.register('hls', hls);

    const source: Source = { type: 'hls', url: 'https://example.com/live.m3u8' };
    const result = await manager.selectAndLoad([source], ['webrtc', 'hls'], {
      video: {} as HTMLVideoElement
    });

    expect(result?.tech).toBe('hls');
    expect(manager.getFailedTechs().has('webrtc')).toBe(true);
  });

  test('rejects duplicate tech registration unless replaced explicitly', () => {
    const manager = new TechManager(new EventBus());
    manager.register('hls', createMockTech());

    expect(() => manager.register('hls', createMockTech())).toThrow('Tech already registered: hls');

    const replacement = createMockTech({ canPlay: (source) => source.type === 'dash' });
    manager.replace('hls', replacement);

    expect(manager.getRegisteredTechs()).toEqual(['hls']);
  });

  test('does not replace the active tech', async () => {
    const manager = new TechManager(new EventBus());
    manager.register('hls', createMockTech({ canPlay: (source) => source.type === 'hls' }));
    await manager.selectAndLoad([{ type: 'hls', url: 'https://example.com/live.m3u8' }], ['hls'], {
      video: {} as HTMLVideoElement
    });

    expect(() => manager.replace('hls', createMockTech())).toThrow('Cannot replace active tech: hls');
    expect(manager.getCurrentTechName()).toBe('hls');
  });

  test('emits network fallback event when using source fallback', async () => {
    const bus = new EventBus();
    const manager = new TechManager(bus);
    const networkEvents: any[] = [];
    bus.on('network', (evt) => networkEvents.push(evt));

    const hlsTech = createMockTech({
      canPlay: (source) => source.type === 'hls',
      loadImpl: async (source) => {
        const hls = source as Extract<Source, { type: 'hls' }>;
        if (hls.url.includes('primary')) {
          throw new Error('primary down');
        }
      }
    });
    const dashTech = createMockTech({ canPlay: (source) => source.type === 'dash' });

    manager.register('hls', hlsTech);
    manager.register('dash', dashTech);

    const source: Source = {
      type: 'hls',
      url: 'https://example.com/primary.m3u8',
      fallbacks: [{ type: 'dash', url: 'https://example.com/fallback.mpd' }]
    };

    const result = await manager.selectAndLoad([source], ['hls', 'dash'], {
      video: {} as HTMLVideoElement
    });

    expect(result?.source).toEqual(source.fallbacks?.[0]);
    expect(result?.tech).toBe('dash');
    expect(networkEvents).toContainEqual(
      expect.objectContaining({
        type: 'fallback',
        code: 'SOURCE_FALLBACK',
        severity: 'info',
        message: '已从 hls 切换到 dash 源',
        from: 'hls',
        to: 'dash'
      })
    );
  });

  test('resetFailedTechs clears failure tracking', () => {
    const manager = new TechManager(new EventBus());
    manager.markTechFailed('webrtc');
    expect(manager.getFailedTechs().has('webrtc')).toBe(true);

    manager.resetFailedTechs();
    expect(manager.getFailedTechs().size).toBe(0);
  });
});
