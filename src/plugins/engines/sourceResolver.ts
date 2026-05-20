import type {
  AutoSource,
  DASHSource,
  HLSSource,
  MiddlewareEntry,
  ResolvedSources,
  Source,
  TechName,
  WebRTCSignalConfig,
  WebRTCSource,
  WSRawSource
} from '../../types.js';
import { EngineFactory, type EngineConfig, type EngineUrls } from './engineFactory.js';

export type SourceResolverProtocol =
  | 'webrtc'
  | 'whep'
  | 'ws-flv'
  | 'http-flv'
  | 'll-hls'
  | 'hls'
  | 'dash';

export interface SourceResolverMiddlewareOptions {
  /** Default engine used when an `auto` source does not set `engine`. */
  defaultEngine?: string;
  /** Per-call engine config. Global defaults can still be set with `EngineFactory.setConfig()`. */
  engineConfig?: EngineConfig | ((source: AutoSource) => EngineConfig | undefined);
  /** Override the engine fallback chain with an explicit protocol order. */
  protocols?: SourceResolverProtocol[];
  /** Codec hint for FLV sources produced as `ws-raw`. */
  wsRawCodec?: 'h264' | 'h265';
  /** Keep resolver-generated fallback sources. Defaults to true. */
  includeFallbacks?: boolean;
  /** Let EngineFactory errors bubble to callers. Defaults to false so Player can emit its standard auto-source error. */
  throwOnUnknownEngine?: boolean;
}

export interface EngineUrlsToSourcesOptions {
  protocols?: readonly SourceResolverProtocol[];
  preferTech?: TechName;
  wsRawCodec?: 'h264' | 'h265';
  includeFallbacks?: boolean;
}

const DEFAULT_PROTOCOLS: SourceResolverProtocol[] = [
  'webrtc',
  'whep',
  'ws-flv',
  'http-flv',
  'll-hls',
  'hls',
  'dash'
];

const PROTOCOL_ALIASES: Record<string, SourceResolverProtocol | undefined> = {
  webrtc: 'webrtc',
  whep: 'whep',
  'ws-flv': 'ws-flv',
  wsflv: 'ws-flv',
  'ws-raw': 'ws-flv',
  httpflv: 'http-flv',
  'http-flv': 'http-flv',
  mse: 'http-flv',
  llhls: 'll-hls',
  'll-hls': 'll-hls',
  hls: 'hls',
  dash: 'dash'
};

function normalizeProtocols(protocols?: readonly string[]): SourceResolverProtocol[] {
  const raw = protocols && protocols.length > 0 ? protocols : DEFAULT_PROTOCOLS;
  const normalized: SourceResolverProtocol[] = [];
  for (const protocol of raw) {
    const mapped = PROTOCOL_ALIASES[protocol.toLowerCase()];
    if (mapped) normalized.push(mapped);
  }
  return normalized.length > 0 ? normalized : DEFAULT_PROTOCOLS;
}

function createWebRTCSource(url: string | undefined, signal?: WebRTCSignalConfig): WebRTCSource | null {
  if (!url) return null;
  const source: WebRTCSource = { type: 'webrtc', url, preferTech: 'webrtc' };
  if (signal) source.signal = signal;
  return source;
}

function sourceFromProtocol(
  protocol: SourceResolverProtocol,
  urls: EngineUrls,
  wsRawCodec: 'h264' | 'h265'
): Source | null {
  switch (protocol) {
    case 'webrtc': {
      const url = urls.webrtcUrl ?? urls.whepUrl;
      const signal =
        !urls.webrtcUrl && urls.whepUrl
          ? { type: 'whep' as const, url: urls.whepUrl, token: urls.whepToken }
          : urls.whepToken && url?.startsWith('http')
            ? { type: 'whep' as const, url, token: urls.whepToken }
            : undefined;
      return createWebRTCSource(url, signal);
    }
    case 'whep': {
      const url = urls.whepUrl ?? urls.webrtcUrl;
      if (!url) return null;
      return createWebRTCSource(url, { type: 'whep', url, token: urls.whepToken });
    }
    case 'ws-flv': {
      if (!urls.wsFlvUrl) return null;
      const source: WSRawSource = {
        type: 'ws-raw',
        url: urls.wsFlvUrl,
        codec: wsRawCodec,
        transport: 'flv',
        pipeline: 'mse',
        preferTech: 'ws-raw'
      };
      return source;
    }
    case 'http-flv': {
      if (!urls.mseUrl) return null;
      const source: WSRawSource = {
        type: 'ws-raw',
        url: urls.mseUrl,
        codec: wsRawCodec,
        transport: 'flv',
        pipeline: 'mse',
        preferTech: 'ws-raw'
      };
      return source;
    }
    case 'll-hls': {
      if (!urls.llHlsUrl) return null;
      const source: HLSSource = {
        type: 'hls',
        url: urls.llHlsUrl,
        lowLatency: true,
        preferTech: 'hls'
      };
      return source;
    }
    case 'hls': {
      if (!urls.hlsUrl) return null;
      const source: HLSSource = {
        type: 'hls',
        url: urls.hlsUrl,
        preferTech: 'hls'
      };
      return source;
    }
    case 'dash': {
      if (!urls.dashUrl) return null;
      const source: DASHSource = {
        type: 'dash',
        url: urls.dashUrl,
        preferTech: 'dash'
      };
      return source;
    }
    default:
      return null;
  }
}

function sourceKey(source: Source): string {
  const url = 'url' in source ? source.url : '';
  return `${source.type}:${url}`;
}

function dedupeSources(sources: Source[]): Source[] {
  const seen = new Set<string>();
  const deduped: Source[] = [];
  for (const source of sources) {
    const key = sourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
  }
  return deduped;
}

function prioritizeSources(sources: Source[], preferTech?: TechName): Source[] {
  if (!preferTech) return sources;
  const preferred = sources.filter((source) => source.preferTech === preferTech || source.type === preferTech);
  if (preferred.length === 0) return sources;
  const rest = sources.filter((source) => !(source.preferTech === preferTech || source.type === preferTech));
  return [...preferred, ...rest];
}

function inheritAutoSourceMetadata(source: Source, autoSource: AutoSource): Source {
  return {
    ...source,
    ...(source.presentation || !autoSource.presentation ? undefined : { presentation: autoSource.presentation }),
    ...(source.meta || !autoSource.meta ? undefined : { meta: autoSource.meta }),
    ...(source.tags || !autoSource.tags ? undefined : { tags: autoSource.tags }),
    ...(source.request || !autoSource.request ? undefined : { request: autoSource.request })
  };
}

export function engineUrlsToResolvedSources(
  urls: EngineUrls,
  options: EngineUrlsToSourcesOptions = {}
): ResolvedSources | null {
  const protocols = normalizeProtocols(options.protocols ?? urls.fallbackChain);
  const wsRawCodec = options.wsRawCodec ?? 'h264';
  const sources = dedupeSources(
    protocols
      .map((protocol) => sourceFromProtocol(protocol, urls, wsRawCodec))
      .filter((source): source is Source => source !== null)
  );
  const ordered = prioritizeSources(sources, options.preferTech);
  const primary = ordered[0];
  if (!primary) return null;
  const fallbacks = options.includeFallbacks === false ? [] : ordered.slice(1);
  return { primary, fallbacks };
}

function resolveEngineConfig(
  source: AutoSource,
  config: SourceResolverMiddlewareOptions['engineConfig']
): EngineConfig | undefined {
  return typeof config === 'function' ? config(source) : config;
}

export function createSourceResolverMiddleware(options: SourceResolverMiddlewareOptions = {}): MiddlewareEntry {
  return {
    kind: 'resolve',
    fn: (ctx) => {
      if (ctx.source.type !== 'auto') return;
      const source = ctx.source;
      const engineName = source.engine ?? options.defaultEngine;
      if (!engineName) return;

      try {
        const urls = EngineFactory.convertUrl(engineName, source.url, resolveEngineConfig(source, options.engineConfig));
        const resolved = engineUrlsToResolvedSources(urls, {
          protocols: options.protocols,
          preferTech: source.preferTech,
          includeFallbacks: options.includeFallbacks,
          wsRawCodec: options.wsRawCodec
        });
        if (!resolved) return;
        const sourceFallbacks = source.fallbacks ?? [];
        return {
          resolvedSources: {
            primary: inheritAutoSourceMetadata(resolved.primary, source),
            fallbacks: [...resolved.fallbacks.map((fallback) => inheritAutoSourceMetadata(fallback, source)), ...sourceFallbacks]
          }
        };
      } catch (err) {
        if (options.throwOnUnknownEngine) throw err;
        return;
      }
    }
  };
}
