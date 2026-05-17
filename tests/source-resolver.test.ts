import { MiddlewareManager } from '../src/core/middleware.js';
import {
  createSourceResolverMiddleware,
  engineUrlsToResolvedSources,
  EngineFactory
} from '../src/plugins/engines/index.js';
import type { Engine, EngineConfig, EngineUrls } from '../src/plugins/engines/index.js';
import type { AutoSource, MiddlewareContext, Source } from '../src/types.js';

function registerFixtureEngine(name: string, urls: EngineUrls, onConfig?: (config?: EngineConfig) => void): void {
  EngineFactory.registerEngine(name, (config) => {
    const engine: Engine = {
      convertUrl() {
        onConfig?.(config);
        return urls;
      },
      getFallbackChain() {
        return urls.fallbackChain;
      }
    };
    return engine;
  });
}

function makeResolveCtx(source: AutoSource): MiddlewareContext {
  return {
    source,
    tech: source.preferTech ?? 'webrtc',
    url: source.url
  };
}

describe('source resolver middleware', () => {
  test('converts engine URLs into ordered resolved sources', () => {
    const resolved = engineUrlsToResolvedSources({
      webrtcUrl: 'http://media.example/live/whep',
      wsFlvUrl: 'ws://media.example/live.flv',
      hlsUrl: 'https://media.example/live.m3u8',
      dashUrl: 'https://media.example/live.mpd',
      fallbackChain: ['webrtc', 'ws-flv', 'hls', 'dash']
    });

    expect(resolved?.primary).toEqual({
      type: 'webrtc',
      url: 'http://media.example/live/whep',
      preferTech: 'webrtc'
    });
    expect(resolved?.fallbacks.map((source) => source.type)).toEqual(['ws-raw', 'hls', 'dash']);
    expect(resolved?.fallbacks[0]).toMatchObject({
      type: 'ws-raw',
      url: 'ws://media.example/live.flv',
      codec: 'h264',
      transport: 'flv',
      pipeline: 'mse',
      preferTech: 'ws-raw'
    });
  });

  test('deduplicates LL-HLS and HLS when an engine returns the same URL', () => {
    const resolved = engineUrlsToResolvedSources({
      llHlsUrl: 'https://media.example/live/index.m3u8',
      hlsUrl: 'https://media.example/live/index.m3u8',
      fallbackChain: ['ll-hls', 'hls']
    });

    expect(resolved?.primary).toEqual({
      type: 'hls',
      url: 'https://media.example/live/index.m3u8',
      lowLatency: true,
      preferTech: 'hls'
    });
    expect(resolved?.fallbacks).toEqual([]);
  });

  test('honors AutoSource preferTech as primary protocol preference', async () => {
    const engineName = 'fixture-source-resolver-prefer';
    registerFixtureEngine(engineName, {
      webrtcUrl: 'http://media.example/live/whep',
      hlsUrl: 'https://media.example/live.m3u8',
      dashUrl: 'https://media.example/live.mpd',
      fallbackChain: ['webrtc', 'hls', 'dash']
    });
    const manager = new MiddlewareManager();
    manager.use(createSourceResolverMiddleware());

    const result = await manager.run(
      'resolve',
      makeResolveCtx({
        type: 'auto',
        url: 'rtsp://media.example/app/stream',
        engine: engineName,
        preferTech: 'hls'
      })
    );

    expect(result.resolvedSources?.primary).toEqual({
      type: 'hls',
      url: 'https://media.example/live.m3u8',
      preferTech: 'hls'
    });
    expect(result.resolvedSources?.fallbacks.map((source) => source.type)).toEqual(['webrtc', 'dash']);
  });

  test('supports default engine, custom protocol order, engine config, and explicit source fallbacks', async () => {
    const engineName = 'fixture-source-resolver-default';
    const seenConfigs: Array<EngineConfig | undefined> = [];
    registerFixtureEngine(
      engineName,
      {
        webrtcUrl: 'http://media.example/live/whep',
        wsFlvUrl: 'ws://media.example/live.flv',
        hlsUrl: 'https://media.example/live.m3u8',
        fallbackChain: ['webrtc', 'ws-flv', 'hls']
      },
      (config) => seenConfigs.push(config)
    );
    const manager = new MiddlewareManager();
    manager.use(
      createSourceResolverMiddleware({
        defaultEngine: engineName,
        protocols: ['hls', 'ws-flv'],
        engineConfig: (source) => ({ tenant: source.url }),
        wsRawCodec: 'h265'
      })
    );
    const explicitFallback: Source = { type: 'dash', url: 'https://backup.example/live.mpd' };

    const result = await manager.run(
      'resolve',
      makeResolveCtx({
        type: 'auto',
        url: 'rtsp://media.example/app/stream',
        fallbacks: [explicitFallback]
      })
    );

    expect(seenConfigs).toEqual([{ tenant: 'rtsp://media.example/app/stream' }]);
    expect(result.resolvedSources?.primary).toEqual({
      type: 'hls',
      url: 'https://media.example/live.m3u8',
      preferTech: 'hls'
    });
    expect(result.resolvedSources?.fallbacks).toEqual([
      {
        type: 'ws-raw',
        url: 'ws://media.example/live.flv',
        codec: 'h265',
        transport: 'flv',
        pipeline: 'mse',
        preferTech: 'ws-raw'
      },
      explicitFallback
    ]);
  });

  test('keeps explicit source fallbacks when generated fallbacks are disabled', async () => {
    const engineName = 'fixture-source-resolver-no-generated-fallbacks';
    registerFixtureEngine(engineName, {
      hlsUrl: 'https://media.example/live.m3u8',
      dashUrl: 'https://media.example/live.mpd',
      fallbackChain: ['hls', 'dash']
    });
    const manager = new MiddlewareManager();
    manager.use(createSourceResolverMiddleware({ includeFallbacks: false }));
    const explicitFallback: Source = { type: 'file', url: 'https://backup.example/live.mp4' };

    const result = await manager.run(
      'resolve',
      makeResolveCtx({
        type: 'auto',
        url: 'rtsp://media.example/app/stream',
        engine: engineName,
        fallbacks: [explicitFallback]
      })
    );

    expect(result.resolvedSources?.primary).toEqual({
      type: 'hls',
      url: 'https://media.example/live.m3u8',
      preferTech: 'hls'
    });
    expect(result.resolvedSources?.fallbacks).toEqual([explicitFallback]);
  });

  test('leaves unresolved auto sources untouched when engine is missing by default', async () => {
    const manager = new MiddlewareManager();
    manager.use(createSourceResolverMiddleware());

    const result = await manager.run(
      'resolve',
      makeResolveCtx({
        type: 'auto',
        url: 'rtsp://media.example/app/stream',
        engine: 'fixture-source-resolver-missing'
      })
    );

    expect(result.resolvedSources).toBeUndefined();
  });

  test('can throw engine errors when requested', async () => {
    const manager = new MiddlewareManager();
    manager.use(createSourceResolverMiddleware({ throwOnUnknownEngine: true }));

    await expect(
      manager.run(
        'resolve',
        makeResolveCtx({
          type: 'auto',
          url: 'rtsp://media.example/app/stream',
          engine: 'fixture-source-resolver-throw-missing'
        })
      )
    ).rejects.toThrow('Unknown engine: fixture-source-resolver-throw-missing');
  });
});
