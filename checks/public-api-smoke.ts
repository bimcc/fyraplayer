import {
  FyraPlayer,
  type BufferPolicy,
  type EngineStats,
  type FMP4BufferPolicy,
  type MetadataDetectedEvent,
  type MetadataEvent,
  type PlayerLevelSwitchEvent,
  type PlayerNetworkCode,
  type PlayerNetworkEvent,
  type PlayerQosCode,
  type PlayerQosEvent,
  type QualityLevel,
  type QualityState,
  type PluginCtor,
  type Gb28181Source,
  type Source,
  type Tech,
  type WSRawSource,
} from 'fyraplayer';
import { createMetadataPlugin, KlvBridge, type MetadataPluginOptions } from 'fyraplayer/plugins/metadata';
import { createMetricsPlugin, metricsPlugin, type MetricsPluginOptions } from 'fyraplayer/plugins/metrics';
import {
  createPerformanceMonitorPlugin,
  DEFAULT_PERFORMANCE_BUDGET,
  type PerformanceBudget,
  type PerformanceMonitorOptions,
  type PerformanceSample,
  type PerformanceViolation,
} from 'fyraplayer/plugins/performance';
import { createReconnectPlugin, reconnectPlugin, type ReconnectPluginOptions } from 'fyraplayer/plugins/reconnect';
import { createStoragePlugin, storagePlugin, type StoragePluginOptions } from 'fyraplayer/plugins/storage';
import { createUiComponentsPlugin } from 'fyraplayer/plugins/ui-components';
import {
  createSourceResolverMiddleware,
  engineUrlsToResolvedSources,
  registerDefaultEngines,
  type SourceResolverMiddlewareOptions,
  type SourceResolverProtocol,
} from 'fyraplayer/plugins/engines';
import {
  createSourceResolverMiddleware as createSourceResolverMiddlewareFromPlugins,
  engineUrlsToResolvedSources as engineUrlsToResolvedSourcesFromPlugins,
  createPerformanceMonitorPlugin as createPerformanceMonitorPluginFromPlugins,
  createReconnectPlugin as createReconnectPluginFromPlugins,
  createStoragePlugin as createStoragePluginFromPlugins,
  type PerformanceMonitorOptions as PerformanceMonitorOptionsFromPlugins,
  type ReconnectPluginOptions as ReconnectPluginOptionsFromPlugins,
  type SourceResolverMiddlewareOptions as SourceResolverMiddlewareOptionsFromPlugins,
  type StoragePluginOptions as StoragePluginOptionsFromPlugins,
} from 'fyraplayer/plugins';
import { Demuxer, type DemuxerCallbacks } from 'fyraplayer/techs/wsRaw/demuxer';

declare module 'fyraplayer' {
  interface CustomTechNameMap {
    acme: true;
  }

  interface CustomSourceMap {
    acme: {
      type: 'acme';
      url: string;
      preferTech?: 'acme';
      token?: string;
    };
  }
}

const acmeTech: Tech = {
  canPlay: (source: Source) => source.type === 'acme',
  async load() {},
  async play() {},
  async pause() {},
  async seek() {},
  async destroy() {},
  getStats: () => ({ ts: Date.now() }),
  on() {},
};

const acmePlugin: PluginCtor = ({ techs }) => {
  const handle = techs.register('acme', acmeTech, { techOrder: 'prepend' });
  techs.getTech('acme')?.getStats().ts.toFixed();
  techs.getRegisteredTechs().map((tech) => tech.toString());
  return {
    destroy: () => handle.unregister(),
  };
};

const player = new FyraPlayer({
  video: '#video',
  sources: [
    { type: 'hls', url: 'https://example.com/stream.m3u8' },
    { type: 'acme', url: 'acme://stream', preferTech: 'acme', token: 'demo' },
  ],
  plugins: [
    acmePlugin,
    createUiComponentsPlugin({
      target: '.player-shell',
      showLog: false,
      poster: '/poster.jpg',
    }),
  ],
});

const resolverOptions: SourceResolverMiddlewareOptions = {
  defaultEngine: 'mediamtx',
  protocols: ['webrtc', 'hls'] satisfies SourceResolverProtocol[],
};
createSourceResolverMiddleware(resolverOptions);
engineUrlsToResolvedSources({
  webrtcUrl: 'http://example.com/live/whep',
  hlsUrl: 'https://example.com/live.m3u8',
  fallbackChain: ['webrtc', 'hls'],
});
registerDefaultEngines();
const aggregatedResolverOptions: SourceResolverMiddlewareOptionsFromPlugins = {
  protocols: ['hls'],
};
createSourceResolverMiddlewareFromPlugins(aggregatedResolverOptions);
engineUrlsToResolvedSourcesFromPlugins({ hlsUrl: 'https://example.com/live.m3u8' });

player.on('metadata', (evt: MetadataEvent | MetadataDetectedEvent) => {
  if (evt.type === 'private-data') {
    evt.raw.byteLength;
    evt.pid?.toFixed();
  }
  if (evt.type === 'private-data-detected') {
    evt.pids?.map((pid) => pid.toFixed());
  }
});

player.on('network', (evt: PlayerNetworkEvent | undefined) => {
  evt?.severity;
  evt?.message;
  const code: PlayerNetworkCode | string | undefined = evt?.code;
  code?.toString();
});

player.on('stats', ({ tech, stats }) => {
  tech.toString();
  stats?.ts.toFixed();
});

player.on('qos', (evt: PlayerQosEvent | undefined) => {
  const code: PlayerQosCode | string | undefined = evt?.code;
  const performanceBudgetCode: PlayerQosCode = 'PERFORMANCE_BUDGET';
  performanceBudgetCode.toString();
  code?.toString();
  evt?.tech?.toString();
  evt?.ts?.toFixed();
});

player.on('levelSwitch', (evt: PlayerLevelSwitchEvent | undefined) => {
  evt?.tech?.toString();
  evt?.bitrateKbps?.toFixed();
  evt?.height?.toFixed();
});

player.currentTime.toFixed();
player.getSources().map((source) => source.type);
player.getCurrentSource()?.type;
const qualityState: QualityState = player.getQualityState();
const qualityLevels: QualityLevel[] = qualityState.levels;
qualityState.tech?.toString();
qualityLevels.map((level) => level.id.toString());
await player.setQualityLevel('auto').catch(() => undefined);
player.enableMetadataExtraction();
player.disableMetadataExtraction();
player.getDetectedPrivateDataPids().map((pid) => pid.toFixed());
player.getDetectedSeiTypes().map((seiType) => seiType.toFixed());

await player.control('gb:ptz', { pan: 1 } as unknown).catch(() => undefined);

const gbGatewaySource: Gb28181Source = {
  type: 'gb28181',
  url: '',
  control: {
    invite: 'https://example.com/gb/invite',
    bye: 'https://example.com/gb/bye',
    ptz: 'https://example.com/gb/ptz',
    query: 'https://example.com/gb/query',
    keepalive: 'https://example.com/gb/keepalive',
  },
  controlRequest: {
    headers: { Authorization: 'Bearer demo' },
    credentials: 'include',
  },
  gb: {
    deviceId: 'device-1',
    channelId: 'channel-1',
    streamMode: 'TCP-Active',
  },
  responseMapping: {
    url: 'play_urls.urls.ws_flv',
    streamId: 'stream_id',
  },
  format: 'flv',
  preferTech: 'gb28181',
};
gbGatewaySource.format?.toString();

const stableWsRawSource: WSRawSource = {
  type: 'ws-raw',
  url: 'https://example.com/live.flv',
  codec: 'h264',
  transport: 'flv',
  pipeline: 'mse',
};
const experimentalWsRawSource: WSRawSource = {
  type: 'ws-raw',
  url: 'wss://example.com/live.ts',
  codec: 'h264',
  transport: 'ts',
  pipeline: 'experimental',
};
stableWsRawSource.pipeline?.toString();
experimentalWsRawSource.pipeline?.toString();

const fmp4BufferPolicy: FMP4BufferPolicy = {
  maxPendingSegments: 120,
  maxPendingBytes: 64 * 1024 * 1024,
  overflowStrategy: 'drop-oldest',
  quotaCleanupKeepBehindMs: 12_000,
  quotaRetryLimit: 2,
};
const bufferPolicy: BufferPolicy = {
  maxBufferMs: 12_000,
  fmp4: fmp4BufferPolicy,
};
bufferPolicy.fmp4?.overflowStrategy?.toString();

const callbacks: DemuxerCallbacks = {
  onPrivateData: (_pid, data, _pts) => data.byteLength,
};
const demuxer = new Demuxer({ format: 'ts', callbacks });
demuxer.demux(new ArrayBuffer(0));

const metadataPluginOptions: MetadataPluginOptions<{ pts: number }> = {
  parse: (event) => ({ pts: event.pts }),
  onData: (parsed) => parsed.pts.toFixed(),
};
createMetadataPlugin(metadataPluginOptions);
const bridge = new KlvBridge(metadataPluginOptions);
await bridge.handle({ type: 'private-data', raw: new Uint8Array(), pts: 0 });

const metricsOptions: MetricsPluginOptions = {
  onStats: (payload) => {
    const stats: EngineStats | undefined = payload.stats;
    stats?.ts.toFixed();
    payload.tech?.toString();
  },
  onQos: (payload) => payload?.code?.toString(),
  onEvent: (event) => event.toString(),
};
createMetricsPlugin(metricsOptions);
metricsPlugin;

const performanceBudget: PerformanceBudget = {
  minFps: DEFAULT_PERFORMANCE_BUDGET.minFps,
  maxDecodeLatencyMs: 80,
  maxPendingBytes: 64 * 1024 * 1024,
};
const performanceOptions: PerformanceMonitorOptions = {
  budget: performanceBudget,
  budgetsByTech: {
    webrtc: { maxRttMs: 800 },
    fmp4: { maxPendingSegments: 120 },
  },
  onSample: (sample: PerformanceSample) => {
    sample.fps?.toFixed();
    sample.tech?.toString();
  },
  onViolation: (violation: PerformanceViolation) => {
    violation.code.toString();
    violation.sample.ts.toFixed();
  },
};
createPerformanceMonitorPlugin(performanceOptions);
const performanceOptionsFromPlugins: PerformanceMonitorOptionsFromPlugins = performanceOptions;
createPerformanceMonitorPluginFromPlugins(performanceOptionsFromPlugins);

const storageOptions: StoragePluginOptions = {
  key: 'fyra:lastSource',
  restoreSource: true,
};
createStoragePlugin(storageOptions);
const storageOptionsFromPlugins: StoragePluginOptionsFromPlugins = storageOptions;
createStoragePluginFromPlugins(storageOptionsFromPlugins);
storagePlugin;

const reconnectOptions: ReconnectPluginOptions = {
  logNetwork: false,
  logError: false,
  onNetwork: (event) => event?.toString(),
  onError: (error) => error?.toString(),
};
createReconnectPlugin(reconnectOptions);
const reconnectOptionsFromPlugins: ReconnectPluginOptionsFromPlugins = reconnectOptions;
createReconnectPluginFromPlugins(reconnectOptionsFromPlugins);
reconnectPlugin;
