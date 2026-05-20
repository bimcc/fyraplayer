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
  type PlayerPreferenceEvent,
  type PlayerQosCode,
  type PlayerQosEvent,
  type PlayerRecordingCode,
  type PlayerRecordingErrorInfo,
  type QualityLevel,
  type QualityState,
  type PluginCtor,
  type Gb28181Source,
  type Source,
  type SourceMetadata,
  type SourcePresentationConfig,
  type Tech,
  type WebRTCSource,
  type WSRawSource,
  getSourcePresentation,
  isPanoramaSource,
  BaseTarget,
  CanvasFrameBuffer,
} from 'fyraplayer';
import { createMetadataPlugin, KlvBridge, type MetadataPluginOptions } from 'fyraplayer/plugins/metadata';
import { createMetricsPlugin, type MetricsPluginOptions } from 'fyraplayer/plugins/metrics';
import {
  createDebugPanelPlugin,
  createDiagnosticsPlugin,
  type DebugPanelPluginOptions,
  type DiagnosticsHandle,
  type DiagnosticsPluginOptions,
  type DiagnosticsSnapshot,
} from 'fyraplayer/plugins/diagnostics';
import {
  createAuthRecoveryPlugin,
  createAuthSigningMiddleware,
  defaultAuthRecoveryMatcher,
  getAuthRecoveryStatus,
  type AuthRecoveryEvent,
  type AuthRecoveryPluginOptions,
  type AuthSigningPluginOptions,
  type AuthTokenResult,
} from 'fyraplayer/plugins/auth';
import {
  createPerformanceMonitorPlugin,
  DEFAULT_PERFORMANCE_BUDGET,
  type PerformanceBudget,
  type PerformanceMonitorOptions,
  type PerformanceSample,
  type PerformanceViolation,
} from 'fyraplayer/plugins/performance';
import {
  createPanoramaLitePlugin,
  createEquirectSphereMesh,
  normalizeView,
  type PanoramaLiteHandle,
  type PanoramaLitePluginOptions,
  type PanoramaLiteQosCode,
} from 'fyraplayer/plugins/panoramalite';
import { createReconnectPlugin, type ReconnectPluginOptions } from 'fyraplayer/plugins/reconnect';
import { createStoragePlugin, type StoragePluginOptions } from 'fyraplayer/plugins/storage';
import {
  createUiComponentsPlugin,
  type UiActionContext,
  type UiComponentsOptions,
  type UiRecordToggleEvent,
  type UiScreenshotEvent,
} from 'fyraplayer/plugins/ui-components';
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
  createAuthRecoveryPlugin as createAuthRecoveryPluginFromPlugins,
  createAuthSigningMiddleware as createAuthSigningMiddlewareFromPlugins,
  createDebugPanelPlugin as createDebugPanelPluginFromPlugins,
  createPerformanceMonitorPlugin as createPerformanceMonitorPluginFromPlugins,
  createPanoramaLitePlugin as createPanoramaLitePluginFromPlugins,
  createDiagnosticsPlugin as createDiagnosticsPluginFromPlugins,
  createReconnectPlugin as createReconnectPluginFromPlugins,
  createRecordingApiPlugin as createRecordingApiPluginFromPlugins,
  createStoragePlugin as createStoragePluginFromPlugins,
  type AuthSigningPluginOptions as AuthSigningPluginOptionsFromPlugins,
  type AuthRecoveryPluginOptions as AuthRecoveryPluginOptionsFromPlugins,
  type DebugPanelPluginOptions as DebugPanelPluginOptionsFromPlugins,
  type DiagnosticsPluginOptions as DiagnosticsPluginOptionsFromPlugins,
  type PerformanceMonitorOptions as PerformanceMonitorOptionsFromPlugins,
  type PanoramaLitePluginOptions as PanoramaLitePluginOptionsFromPlugins,
  type RecordingApiPluginOptions as RecordingApiPluginOptionsFromPlugins,
  type ReconnectPluginOptions as ReconnectPluginOptionsFromPlugins,
  type SourceResolverMiddlewareOptions as SourceResolverMiddlewareOptionsFromPlugins,
  type StoragePluginOptions as StoragePluginOptionsFromPlugins,
} from 'fyraplayer/plugins';
import {
  RecordingApiError,
  createRecordingApiPlugin,
  type RecordingApiHandle,
  type RecordingApiPluginOptions,
  type RecordingApiResponse,
} from 'fyraplayer/plugins/recording-api';
import { createDashTechPlugin, type DashTechPluginOptions } from 'fyraplayer/plugins/dash';
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
      showStatusOverlay: true,
      onRetry: async () => undefined,
      onDiagnostics: (context: UiActionContext) => {
        context.video.paused.valueOf();
      },
      onScreenshot: (event: UiScreenshotEvent) => {
        event.filename.toString();
      },
      showRecordingButton: true,
      onRecordToggle: (event: UiRecordToggleEvent) => {
        event.recording.valueOf();
      },
    }),
  ],
});

const uiOptions: UiComponentsOptions = {
  target: '.player-shell',
  showStatusOverlay: true,
  onRetry: () => player.play(),
  showDiagnosticsButton: true,
  onDiagnostics: ({ player: uiPlayer }) => {
    uiPlayer.getState().toString();
  },
  onScreenshot: ({ blob, width, height }) => {
    blob.size.toFixed();
    width.toFixed();
    height.toFixed();
  },
  showRecordingButton: true,
  onRecordToggle: ({ recording }) => {
    recording.valueOf();
  },
};
createUiComponentsPlugin(uiOptions);
const dashOptions: DashTechPluginOptions = { techOrder: 'append' };
createDashTechPlugin(dashOptions);

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

player.on('preference', (evt: PlayerPreferenceEvent) => {
  evt.key.toString();
  evt.source?.toString();
});
player.on('recording', (evt) => {
  evt.status.toString();
  evt.recordingId?.toString();
  evt.tech?.toString();
});

player.currentTime.toFixed();
player.getVideoElement().paused.valueOf();
player.getSources().map((source) => source.type);
player.getCurrentSource()?.type;
const presentationSource: Source = {
  type: 'hls',
  url: 'https://example.com/live360.m3u8',
  presentation: {
    mode: 'panorama',
    projection: 'equirectangular',
    renderer: 'panoramalite',
    textureFlipX: false,
    textureFlipY: false,
  },
  tags: ['panorama'],
};
const presentationConfig: SourcePresentationConfig | undefined = getSourcePresentation(presentationSource);
presentationConfig?.mode?.toString();
isPanoramaSource(presentationSource).valueOf();
const platformMeta: SourceMetadata = {
  tags: ['inspection'],
  presentation: { mode: 'normal' },
};
platformMeta.tags?.map((tag) => tag.toString());
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
  playoutDelayHintMs: 250,
};
bufferPolicy.fmp4?.overflowStrategy?.toString();
bufferPolicy.playoutDelayHintMs?.toFixed();

const hardenedWebrtcSource: WebRTCSource = {
  type: 'webrtc',
  url: 'https://example.com/live/whep',
  iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    { urls: 'turn:turn.example.com:3478?transport=tcp', username: 'demo', credential: 'secret' },
  ],
  forceRelay: true,
  signal: {
    type: 'whep',
    url: 'https://example.com/live/whep',
    timeoutMs: 15_000,
    iceGatheringTimeoutMs: 5_000,
  },
};
hardenedWebrtcSource.iceServers?.length.toFixed();
hardenedWebrtcSource.forceRelay?.valueOf();
if (hardenedWebrtcSource.signal?.type === 'whep') {
  hardenedWebrtcSource.signal.timeoutMs?.toFixed();
  hardenedWebrtcSource.signal.iceGatheringTimeoutMs?.toFixed();
}

const callbacks: DemuxerCallbacks = {
  onPrivateData: (_pid, data, _pts) => data.byteLength,
};
const demuxer = new Demuxer({ format: 'ts', callbacks });
demuxer.demux(new ArrayBuffer(0));

class ExternalRenderTarget extends BaseTarget {
  public attached: HTMLVideoElement | undefined;
  attach(video: HTMLVideoElement): void {
    this.attached = video;
  }
  detach(): void {
    this.attached = undefined;
  }
  render(time: number): void {
    time.toFixed();
  }
  destroy(): void {
    this.detach();
  }
}
const renderTarget = new ExternalRenderTarget();
renderTarget.attach(document.createElement('video'));
renderTarget.render(0);
renderTarget.detach();
renderTarget.destroy();
const canvasFrameBuffer = new CanvasFrameBuffer();
canvasFrameBuffer.getCanvas().width.toFixed();
canvasFrameBuffer.getCaptureStream(30)?.getTracks().length.toFixed();
canvasFrameBuffer.destroy();

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

let diagnosticsHandle: DiagnosticsHandle | undefined;
const diagnosticsOptions: DiagnosticsPluginOptions = {
  maxEvents: 100,
  onHandle: (handle) => {
    diagnosticsHandle = handle;
  },
  onSnapshot: (snapshot: DiagnosticsSnapshot) => {
    snapshot.state?.toString();
    snapshot.tech?.toString();
    snapshot.latestNetwork?.code?.toString();
    snapshot.latestStats?.fps?.toFixed();
  },
  onEvent: (record, snapshot) => {
    record.type.toString();
    snapshot.recent.length.toFixed();
  },
};
createDiagnosticsPlugin(diagnosticsOptions);
const diagnosticsOptionsFromPlugins: DiagnosticsPluginOptionsFromPlugins = diagnosticsOptions;
createDiagnosticsPluginFromPlugins(diagnosticsOptionsFromPlugins);
diagnosticsHandle?.exportJson();

const debugPanelOptions: DebugPanelPluginOptions = {
  target: '.player-shell',
  maxEvents: 50,
};
createDebugPanelPlugin(debugPanelOptions);
const debugPanelOptionsFromPlugins: DebugPanelPluginOptionsFromPlugins = debugPanelOptions;
createDebugPanelPluginFromPlugins(debugPanelOptionsFromPlugins);

const authOptions: AuthSigningPluginOptions = {
  headers: { 'x-app': 'demo' },
  credentials: 'include',
  token: async (): Promise<AuthTokenResult> => ({ token: 'demo', expiresAt: Date.now() + 60_000 }),
  signUrl: ({ url }) => `${url}?sig=ok`,
  refreshHeaders: ({ headers }) => ({ ...headers, 'x-refresh': '1' }),
};
const authMiddleware = createAuthSigningMiddleware(authOptions);
authMiddleware.map((entry) => entry.kind.toString());
const authOptionsFromPlugins: AuthSigningPluginOptionsFromPlugins = authOptions;
createAuthSigningMiddlewareFromPlugins(authOptionsFromPlugins);
const authRecoveryOptions: AuthRecoveryPluginOptions = {
  maxRetries: 1,
  cooldownMs: 1000,
  match: (trigger) => defaultAuthRecoveryMatcher(trigger),
  refresh: async ({ sourceIndex }) => {
    sourceIndex.toFixed();
  },
  onRecovery: (event: AuthRecoveryEvent) => {
    event.phase.toString();
    event.status?.toFixed();
  },
};
createAuthRecoveryPlugin(authRecoveryOptions);
getAuthRecoveryStatus({ response: { status: 401 } })?.toFixed();
const authRecoveryOptionsFromPlugins: AuthRecoveryPluginOptionsFromPlugins = authRecoveryOptions;
createAuthRecoveryPluginFromPlugins(authRecoveryOptionsFromPlugins);

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

let panoramaHandle: PanoramaLiteHandle | undefined;
const panoramaOptions: PanoramaLitePluginOptions = {
  target: '.player-shell',
  media: 'video',
  projection: 'equirectangular',
  enabled: false,
  interactive: true,
  initialView: { yaw: 0, pitch: 0, fov: 80 },
  limits: { minFov: 35, maxFov: 110 },
  maxPixelRatio: 1.5,
  onReady: (handle) => {
    panoramaHandle = handle;
  },
  onError: (error) => error?.toString(),
};
createPanoramaLitePlugin(panoramaOptions);
const panoramaOptionsFromPlugins: PanoramaLitePluginOptionsFromPlugins = panoramaOptions;
createPanoramaLitePluginFromPlugins(panoramaOptionsFromPlugins);
panoramaHandle?.setEnabled(true);
panoramaHandle?.isEnabled().valueOf();
panoramaHandle?.setView({ yaw: 45 });
panoramaHandle?.getView().fov.toFixed();
const panoramaMesh = createEquirectSphereMesh({ widthSegments: 16, heightSegments: 8 });
panoramaMesh.indices.length.toFixed();
normalizeView({ yaw: 540, pitch: 120, fov: 10 }).yaw.toFixed();
const panoramaCode: PanoramaLiteQosCode = 'PANORAMALITE_READY';
panoramaCode.toString();

const storageOptions: StoragePluginOptions = {
  key: 'fyra:lastSource',
  preferencesKey: 'fyra:preferences',
  restoreSource: true,
  persistSource: true,
  persistVolume: true,
  persistMuted: true,
  persistPlaybackRate: true,
  persistQuality: true,
  persistLowLatency: true,
  video: '#video',
};
createStoragePlugin(storageOptions);
const storageOptionsFromPlugins: StoragePluginOptionsFromPlugins = storageOptions;
createStoragePluginFromPlugins(storageOptionsFromPlugins);

const reconnectOptions: ReconnectPluginOptions = {
  logNetwork: false,
  logError: false,
  onNetwork: (event) => event?.toString(),
  onError: (error) => error?.toString(),
};
createReconnectPlugin(reconnectOptions);
const reconnectOptionsFromPlugins: ReconnectPluginOptionsFromPlugins = reconnectOptions;
createReconnectPluginFromPlugins(reconnectOptionsFromPlugins);

let recordingHandle: RecordingApiHandle | undefined;
const recordingOptions: RecordingApiPluginOptions = {
  startUrl: 'https://example.com/recording/start',
  stopUrl: ({ recordingId }) => `https://example.com/recording/${recordingId ?? 'current'}/stop`,
  statusUrl: 'https://example.com/recording/status',
  headers: ({ action }) => ({ 'x-recording-action': action }),
  credentials: 'include',
  buildBody: ({ source, tech }) => ({ sourceType: source?.type, tech }),
  parseResponse: async (): Promise<RecordingApiResponse> => ({ recordingId: 'rec-1', status: 'recording' }),
  onHandle: (handle) => {
    recordingHandle = handle;
  },
  onEvent: (event) => {
    event.status.toString();
    event.code?.toString();
  },
};
createRecordingApiPlugin(recordingOptions);
const recordingOptionsFromPlugins: RecordingApiPluginOptionsFromPlugins = recordingOptions;
createRecordingApiPluginFromPlugins(recordingOptionsFromPlugins);
recordingHandle?.isRecording();
const recordingCode: PlayerRecordingCode = 'RECORDING_HTTP_ERROR';
recordingCode.toString();
const recordingErrorInfo: PlayerRecordingErrorInfo = {
  code: recordingCode,
  message: 'recording failed',
  action: 'start',
  status: 403,
};
new RecordingApiError(recordingErrorInfo).info.code.toString();
