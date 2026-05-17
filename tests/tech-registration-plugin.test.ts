import { FyraPlayer } from '../src/player.js';
import type { CustomSourceMap, CustomTechNameMap, PluginCtor, Source, Tech } from '../src/types.js';
import { mockTechInstances, resetMockTechInstances } from './mocks/tech-base.js';

declare module '../src/types.js' {
  interface CustomTechNameMap {
    acme: true;
    backup: true;
  }

  interface CustomSourceMap {
    acme: {
      type: 'acme';
      url: string;
      preferTech?: 'acme';
    };
    backup: {
      type: 'backup';
      url: string;
      preferTech?: 'backup';
    };
  }
}

(globalThis as any).window = { localStorage: null };

function createVideoStub(): HTMLVideoElement {
  return {
    autoplay: false,
    muted: false,
    preload: 'none',
    src: '',
    srcObject: null,
    load: () => {},
    play: async () => {},
    pause: () => {},
    paused: false,
    currentTime: 0
  } as unknown as HTMLVideoElement;
}

type Handler = (...args: unknown[]) => void;

class CustomTech implements Tech {
  public loadedSources: Source[] = [];
  public destroyCalls = 0;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(private readonly sourceType: Source['type']) {}

  canPlay(source: Source): boolean {
    return source.type === this.sourceType;
  }

  async load(source: Source): Promise<void> {
    this.loadedSources.push(source);
    this.emit('ready');
  }

  async play(): Promise<void> {}
  async pause(): Promise<void> {}
  async seek(): Promise<void> {}

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }

  getStats() {
    return { ts: Date.now() };
  }

  on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((handler) => handler(...args));
  }
}

describe('third-party tech registration plugin API', () => {
  beforeEach(() => {
    resetMockTechInstances();
  });

  test('plugin can register a custom tech and load a custom source', async () => {
    const acmeTech = new CustomTech('acme');
    const seenRegisteredTechs: string[][] = [];
    const plugin: PluginCtor = ({ techs }) => {
      const before = techs.getRegisteredTechs().map(String);
      const handle = techs.register('acme', acmeTech, { techOrder: 'prepend' });
      const after = techs.getRegisteredTechs().map(String);
      seenRegisteredTechs.push(before, after);
      return {
        destroy: () => handle.unregister()
      };
    };

    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'acme', url: 'acme://stream', preferTech: 'acme' }],
      techOrder: ['hls'],
      plugins: [plugin]
    });

    await player.init();

    expect(acmeTech.loadedSources).toEqual([{ type: 'acme', url: 'acme://stream', preferTech: 'acme' }]);
    expect(player.getState()).toBe('ready');
    expect(seenRegisteredTechs[0]).not.toContain('acme');
    expect(seenRegisteredTechs[1]).toContain('acme');

    await player.destroy();
    expect(acmeTech.destroyCalls).toBe(1);
  });

  test('plugin tech registration handle is idempotent and removes tech order entry', async () => {
    const acmeTech = new CustomTech('acme');
    let unregister!: () => Promise<void>;
    const plugin: PluginCtor = ({ techs }) => {
      const handle = techs.register('acme', acmeTech, { techOrder: 'append' });
      unregister = handle.unregister;
    };
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [
        { type: 'hls', url: 'https://example.com/live.m3u8' },
        { type: 'acme', url: 'acme://stream', preferTech: 'acme' }
      ],
      techOrder: ['hls'],
      plugins: [plugin]
    });

    await unregister();
    await unregister();
    await expect(player.switchSource(1)).resolves.toBeUndefined();

    expect(acmeTech.loadedSources).toEqual([]);
    expect(player.getState()).toBe('error');

    await player.destroy();
  });

  test('plugin cannot register duplicate tech names unless replace is explicit', () => {
    let duplicateError: unknown;
    const duplicatePlugin: PluginCtor = ({ techs }) => {
      techs.register('acme', new CustomTech('acme'));
      try {
        techs.register('acme', new CustomTech('acme'));
      } catch (err) {
        duplicateError = err;
      }
    };

    new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'acme', url: 'acme://stream', preferTech: 'acme' }],
      plugins: [duplicatePlugin]
    });

    expect(duplicateError).toBeInstanceOf(Error);
    expect((duplicateError as Error).message).toBe('Tech already registered: acme');
  });

  test('plugin can replace an inactive built-in tech implementation explicitly', async () => {
    const hlsReplacement = new CustomTech('hls');
    let currentHlsTech: Tech | null = null;
    let originalHlsTech: Tech | null = null;
    const plugin: PluginCtor = ({ techs }) => {
      originalHlsTech = techs.getTech('hls');
      const handle = techs.register('hls', hlsReplacement, { replace: true, techOrder: 'prepend' });
      expect(originalHlsTech).toBeDefined();
      expect(techs.getTech('hls')).toBe(hlsReplacement);
      return {
        destroy: async () => {
          await handle.unregister();
          currentHlsTech = techs.getTech('hls');
        }
      };
    };

    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://example.com/live.m3u8' }],
      plugins: [plugin]
    });

    await player.init();

    expect(hlsReplacement.loadedSources).toEqual([{ type: 'hls', url: 'https://example.com/live.m3u8' }]);
    await player.destroy();

    expect(hlsReplacement.destroyCalls).toBe(1);
    expect(currentHlsTech).toBe(originalHlsTech);
  });

  test('replacement handle can unregister an active replacement and restore built-in tech order', async () => {
    const hlsReplacement = new CustomTech('hls');
    let unregister!: () => Promise<void>;
    const plugin: PluginCtor = ({ techs }) => {
      const handle = techs.register('hls', hlsReplacement, { replace: true, techOrder: 'prepend' });
      unregister = handle.unregister;
    };
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://example.com/live.m3u8' }],
      techOrder: ['dash', 'hls'],
      plugins: [plugin]
    });

    await player.init();
    try {
      expect(hlsReplacement.loadedSources).toHaveLength(1);

      await unregister();
      expect(hlsReplacement.destroyCalls).toBe(1);
      await player.switchSource(0);

      expect(hlsReplacement.loadedSources).toHaveLength(1);
      expect(mockTechInstances.hls[0]?.lastLoadedSource).toEqual({
        type: 'hls',
        url: 'https://example.com/live.m3u8'
      });
    } finally {
      await player.destroy();
    }
  });

  test('custom source and tech augmentation types are usable from public types', () => {
    const techName: keyof CustomTechNameMap = 'acme';
    const source: CustomSourceMap['acme'] = { type: 'acme', url: 'acme://stream', preferTech: 'acme' };

    expect(techName).toBe('acme');
    expect(source.preferTech).toBe('acme');
  });
});
