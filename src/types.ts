export type BuiltinTechName = 'webrtc' | 'hls' | 'dash' | 'fmp4' | 'ws-raw' | 'file' | 'gb28181';

/**
 * Module-augmentation hook for third-party Tech names.
 *
 * Example:
 * declare module 'fyraplayer' {
 *   interface CustomTechNameMap {
 *     'acme-live': true;
 *   }
 * }
 */
export interface CustomTechNameMap {}

export type CustomTechName = Extract<keyof CustomTechNameMap, string>;
export type TechName = BuiltinTechName | CustomTechName;

// ============================================================================
// Metadata Configuration (for KLV/SEI extraction)
// ============================================================================

/** Configuration for metadata extraction from MPEG-TS streams */
export interface MetadataConfig {
  /** Private data stream extraction (KLV, etc.) */
  privateData?: {
    /** Enable private data extraction */
    enable: boolean;
    /** Manual PID specification; auto-detect from PMT if not provided */
    pids?: number[];
    /** 
     * Detect-only mode: detect private data PIDs but don't extract until triggered.
     * When true, only emits 'metadata-detected' events with PID info.
     * Call player.enableMetadataExtraction() to start actual extraction.
     * @default false
     */
    detectOnly?: boolean;
  };
  /** SEI NAL unit extraction */
  sei?: {
    /** Enable SEI extraction */
    enable: boolean;
    /**
     * Detect-only mode: detect SEI NALs but don't extract until triggered.
     * @default false
     */
    detectOnly?: boolean;
  };
}

/** Metadata detection event (emitted in detectOnly mode) */
export interface MetadataDetectedEvent {
  /** Event type */
  type: 'private-data-detected' | 'sei-detected';
  /** Detected PIDs for private data */
  pids?: number[];
  /** Stream type from PMT (0x06 = PES private, 0x15 = metadata) */
  streamTypes?: Map<number, number>;
  /** Detected SEI types */
  seiTypes?: number[];
}

// ============================================================================
// Source Types
// ============================================================================

export type SourcePresentationMode = 'normal' | 'panorama';
export type SourceProjection = 'equirectangular' | (string & {});

export interface SourcePresentationConfig {
  /**
   * Presentation mode requested by the source platform.
   * `panorama` means product UI may switch to a panorama renderer such as PanoramaLite.
   */
  mode?: SourcePresentationMode;
  /** Projection used by panorama-capable renderers. */
  projection?: SourceProjection;
  /** Optional preferred renderer/plugin hint, e.g. `panoramalite`. */
  renderer?: 'panoramalite' | (string & {});
  /** Source-specific texture orientation correction for panorama renderers. */
  textureFlipX?: boolean;
  /** Source-specific texture orientation correction for panorama renderers. */
  textureFlipY?: boolean;
  [key: string]: unknown;
}

export interface SourceMetadata {
  /** Platform/business tags, e.g. `panorama`, `360`, `drone`, `inspection`. */
  tags?: string[];
  /** Nested presentation metadata from a source platform response. */
  presentation?: SourcePresentationConfig;
  [key: string]: unknown;
}

/** Base source fields shared by all source types */
interface BaseSourceFields {
  /** Fallback sources to try if this source fails */
  fallbacks?: Source[];
  /** Optional request configuration applied by Techs that perform fetch/XHR signaling or media requests. */
  request?: SourceRequestConfig;
  /**
   * Playback presentation metadata. This is not a Tech selector; apps/plugins
   * use it to choose surfaces such as ordinary video or panorama rendering.
   */
  presentation?: SourcePresentationConfig;
  /** Flat platform tags for app/plugin decisions. */
  tags?: string[];
  /** Structured platform metadata. Use `meta.presentation` when mirroring upstream API shapes. */
  meta?: SourceMetadata;
}

export interface SourceRequestConfig {
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
}

export type WebRTCSource = BaseSourceFields & {
  type: 'webrtc';
  url: string;
  iceServers?: RTCIceServer[];
  /** Force relay transport when true (helps in restricted/unstable UDP networks) */
  forceRelay?: boolean;
  preferTech?: 'webrtc';
  signal?: WebRTCSignalConfig;
};

export type HLSSource = BaseSourceFields & {
  type: 'hls';
  url: string;
  lowLatency?: boolean;
  drm?: DRMConfig;
  preferTech?: 'hls';
};

export type DASHSource = BaseSourceFields & {
  type: 'dash';
  url: string;
  drm?: DRMConfig;
  preferTech?: 'dash';
};

export type FMP4Source = BaseSourceFields & {
  type: 'fmp4';
  url: string;
  /** Transport method: http (fetch) or ws (WebSocket) */
  transport: 'http' | 'ws';
  /** Exact MediaSource MIME type. Use when the stream profile is known, e.g. avc1.4d401f. */
  mimeType?: string;
  /** Video codec hint for MSE initialization */
  codec?: 'h264' | 'h265' | 'av1';
  /** Exact video codec string for MSE initialization. Overrides codec defaults. */
  videoCodecString?: string;
  /** Audio codec hint */
  audioCodec?: 'aac' | 'opus' | 'mp3';
  /** Exact audio codec string for MSE initialization. Overrides audioCodec defaults. */
  audioCodecString?: string;
  /** Whether this is a live stream */
  isLive?: boolean;
  preferTech?: 'fmp4';
};

export type WSRawSource = BaseSourceFields & {
  type: 'ws-raw';
  url: string;
  codec: 'h264' | 'h265';
  transport?: 'flv' | 'ts' | 'annexb';
  heartbeatMs?: number;
  preferTech?: 'ws-raw';
  /**
   * Playback pipeline selection.
   * - `mse` is the stable default and uses mpegts.js/MSE fallback.
   * - `experimental` enables the in-house WebCodecs/WASM pipeline and may fall back to MSE.
   */
  pipeline?: 'mse' | 'experimental';
  decoderUrl?: string;
  wasm?: WasmDecoderConfig;
  disableAudio?: boolean;
  audioOptional?: boolean;
  /** Use WebTransport (datagrams) instead of WebSocket if true */
  webTransport?: boolean;
  /** Metadata extraction configuration (only for transport: 'ts') */
  metadata?: MetadataConfig;
};

export type Gb28181Source = BaseSourceFields & {
  type: 'gb28181';
  /** Data WebSocket/WebTransport URL */
  url: string;
  /** Control endpoints for invite/bye/ptz/query/keepalive */
  control: {
    invite: string;
    bye: string;
    ptz?: string;
    query?: string;
    keepalive?: string;
  };
  /** Optional request config for control endpoints (invite/bye/ptz/query/keepalive). */
  controlRequest?: {
    headers?: Record<string, string>;
    credentials?: RequestCredentials;
  };
  gb: {
    deviceId: string;
    channelId: string;
    ssrc?: string;
    /** Optional GB invite stream mode override */
    streamMode?: 'UDP' | 'TCP-Active' | 'TCP-Passive';
    transport?: 'udp' | 'tcp';
    expires?: number;
  };
  /**
   * Optional mapping to extract fields from non-standard invite responses.
   * Supports dot-path syntax, e.g. "play_urls.ws_flv".
   */
  responseMapping?: {
    /** Data channel URL path. Fallbacks: url -> wsUrl -> source.url */
    url?: string;
    /** Session/call id path. Fallbacks: callId -> dialogId */
    callId?: string;
    /** SSRC path. Fallback: ssrc */
    ssrc?: string;
    /** Optional stream/session info object path. Fallback: streamInfo. Player does not parse GB media details. */
    streamInfo?: string;
    /** Stream id path. Fallbacks: stream_id -> streamId */
    streamId?: string;
  };
  /** Standard container returned by the GB gateway. Browser-side GB28181 only supports FLV/TS playback. */
  format?: 'flv' | 'ts';
  preferTech?: 'gb28181';
};

export type FileSource = BaseSourceFields & {
  type: 'file';
  url: string;
  preferTech?: 'file';
  /** Container format hint for blob URLs (since extension is not available) */
  container?: 'ts' | 'mp4' | 'mkv' | 'webm' | 'flv';
  /** Metadata extraction configuration (only for TS files with WebCodecs) */
  metadata?: MetadataConfig;
  /** WebCodecs configuration for file playback */
  webCodecs?: WebCodecsConfig;
};

/** Auto source that requires resolution via EngineAdapter middleware */
export type AutoSource = BaseSourceFields & {
  type: 'auto';
  url: string;
  /** Engine hint for adapter selection: 'ome' | 'srs' | 'zlm' | 'mediamtx' */
  engine?: string;
  /** Preferred tech to use after resolution */
  preferTech?: TechName;
};

export type BuiltinSource =
  | WebRTCSource
  | HLSSource
  | DASHSource
  | FMP4Source
  | WSRawSource
  | Gb28181Source
  | FileSource
  | AutoSource;

/**
 * Module-augmentation hook for third-party Source shapes.
 *
 * Example:
 * declare module 'fyraplayer' {
 *   interface CustomSourceMap {
 *     AcmeLiveSource: { type: 'acme-live'; url: string; preferTech?: 'acme-live' };
 *   }
 * }
 */
export interface CustomSourceMap {}

export type CustomSource = keyof CustomSourceMap extends never
  ? never
  : CustomSourceMap[keyof CustomSourceMap] &
      BaseSourceFields & {
        type: string;
        url: string;
        preferTech?: TechName;
      };
export type Source = BuiltinSource | CustomSource;

const PANORAMA_SOURCE_TAGS = new Set(['panorama', '360', '360-video', 'equirect', 'equirectangular']);

function getSourceTags(source: Source): string[] {
  return [...(source.tags ?? []), ...(source.meta?.tags ?? [])]
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function hasPanoramaTag(source: Source): boolean {
  return getSourceTags(source).some((tag) => PANORAMA_SOURCE_TAGS.has(tag));
}

function legacyPanoramaPresentation(source: Source): SourcePresentationConfig | undefined {
  const legacy = source as Source & {
    panorama?: boolean;
    textureFlipX?: boolean;
    textureFlipY?: boolean;
  };
  if (!legacy.panorama && !hasPanoramaTag(source)) return undefined;
  return {
    mode: 'panorama',
    projection: 'equirectangular',
    ...(typeof legacy.textureFlipX === 'boolean' ? { textureFlipX: legacy.textureFlipX } : undefined),
    ...(typeof legacy.textureFlipY === 'boolean' ? { textureFlipY: legacy.textureFlipY } : undefined)
  };
}

export function getSourcePresentation(source: Source | null | undefined): SourcePresentationConfig | undefined {
  if (!source) return undefined;
  const presentation = source.presentation ?? source.meta?.presentation;
  const inferredMode = hasPanoramaTag(source) ? 'panorama' : undefined;
  if (presentation) {
    const mode = presentation.mode ?? inferredMode;
    return mode ? { ...presentation, mode } : presentation;
  }
  return legacyPanoramaPresentation(source);
}

export function isPanoramaSource(source: Source | null | undefined): boolean {
  return getSourcePresentation(source)?.mode === 'panorama';
}

// Type guards for Source discriminated union
export function isWebRTCSource(s: Source): s is WebRTCSource {
  return s.type === 'webrtc';
}

export function isHLSSource(s: Source): s is HLSSource {
  return s.type === 'hls';
}

export function isDASHSource(s: Source): s is DASHSource {
  return s.type === 'dash';
}

export function isWSRawSource(s: Source): s is WSRawSource {
  return s.type === 'ws-raw';
}

export function isFileSource(s: Source): s is FileSource {
  return s.type === 'file';
}

export function isFMP4Source(s: Source): s is FMP4Source {
  return s.type === 'fmp4';
}

export function isAutoSource(s: Source): s is AutoSource {
  return s.type === 'auto';
}

export function isGb28181Source(s: Source): s is Gb28181Source {
  return s.type === 'gb28181';
}

// ============================================================================
// Engine Adapter Interface (for stream server integration)
// ============================================================================

/** Configuration for stream server connection */
export interface ServerConfig {
  host: string;
  port?: number;
  app?: string;
  secure?: boolean;
}

/** Options for URL resolution */
export interface ResolveOptions {
  preferProtocol?: 'webrtc' | 'hls' | 'dash' | 'ws-raw';
  lowLatency?: boolean;
}

/** Resolved sources with primary and fallbacks */
export interface ResolvedSources {
  primary: Source;
  fallbacks: Source[];
}

/**
 * Engine Adapter interface for stream server integration.
 * Implementations should be in external packages, not in the player core.
 */
export interface EngineAdapter {
  /** Adapter name, e.g., 'ome', 'srs', 'zlm', 'mediamtx' */
  name: string;

  /** Convert publish URL to playback URLs */
  resolveFromPublish(publishUrl: string, options?: ResolveOptions): ResolvedSources;

  /** Resolve playback URLs from stream name and server config */
  resolveFromStream(streamName: string, serverConfig: ServerConfig): ResolvedSources;

  /** Get recommended protocol fallback chain */
  getFallbackChain(): TechName[];
}

export interface PlaybackLimits {
  maxHeight?: number;
  maxBitrateKbps?: number;
}

export interface DRMConfig {
  type: 'clearkey' | 'widevine' | 'playready';
  licenseUrl: string;
  headers?: Record<string, string>;
}

export interface BufferPolicy {
  targetLatencyMs?: number;
  maxBufferMs?: number;
  jitterBufferMs?: number;
  /** Hint for WebRTC jitter buffer (mapped to RTCRtpReceiver.playoutDelayHint, in ms) */
  playoutDelayHintMs?: number;
  catchUpMode?: 'drop-b' | 'drop-bp' | 'skip-to-latest';
  decodeBudgetMs?: number;
  /** fMP4/MSE pending append queue and quota policy. */
  fmp4?: FMP4BufferPolicy;
  catchUp?: {
    maxBufferMs?: number;
    maxFrames?: number;
    mode?: 'none' | 'drop-to-key' | 'latest';
  };
}

export interface FMP4BufferPolicy {
  /** Maximum queued fMP4 segments waiting for SourceBuffer.appendBuffer(). */
  maxPendingSegments?: number;
  /** Maximum queued fMP4 bytes waiting for SourceBuffer.appendBuffer(). */
  maxPendingBytes?: number;
  /**
   * Queue overflow behavior.
   * - drop-oldest keeps low-latency live playback bounded.
   * - drop-newest protects existing queued media.
   * - error rejects the overflowing segment and emits player error.
   */
  overflowStrategy?: 'drop-oldest' | 'drop-newest' | 'error';
  /** Buffered media kept behind currentTime when recovering from QuotaExceededError. */
  quotaCleanupKeepBehindMs?: number;
  /** Number of quota cleanup attempts before the queued segment is dropped or rejected. */
  quotaRetryLimit?: number;
}

export interface ReconnectPolicy {
  enabled: boolean;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  heartbeatMs?: number;
  timeoutMs?: number;
}

export interface MetricsOptions {
  statsIntervalMs?: number;
  qosIntervalMs?: number;
}

export interface WebCodecsConfig {
  enable?: boolean;
  allowH265?: boolean;
  /** Prefer MP4 WebCodecs path for file sources when available */
  preferMp4?: boolean;
  /**
   * Optional MP4Box loader for the experimental MP4 WebCodecs file path.
   * Keeping this app-provided avoids forcing bundlers to scan mp4box unless
   * that path is explicitly used.
   */
  mp4boxLoader?: () => Promise<unknown> | unknown;
}

/**
 * Optional mpegts.js loader for TS/FLV MSE fallback paths.
 * Keeping this app-provided avoids forcing default package consumers to install
 * mpegts.js and its GitHub-hosted transitive dependency unless TS/FLV playback
 * is explicitly used.
 */
export type MpegtsLoader = () => Promise<unknown> | unknown;

export interface WasmDecoderConfig {
  /** Prefer SharedArrayBuffer/COOP+COEP path when available */
  enableSharedArrayBuffer?: boolean;
  /** Transfer input buffers to worker to reduce copies */
  transferFrames?: boolean;
  /** Pthread pool size hint for Emscripten-based decoders */
  workerThreads?: number;
  /** Require crossOriginIsolated to proceed when using SAB/pthreads */
  requireCrossOriginIsolated?: boolean;
}

export interface DataChannelOptions {
  enable?: boolean;
  label?: string;
  heartbeatMs?: number;
}

export interface PlayerOptions {
  sources: Source[];
  techOrder?: TechName[];
  autoplay?: boolean;
  muted?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  video: HTMLVideoElement | string; // element or selector
  plugins?: PluginCtor[];
  middleware?: MiddlewareEntry[];
  metrics?: MetricsOptions;
  buffer?: BufferPolicy;
  reconnect?: ReconnectPolicy;
  webCodecs?: WebCodecsConfig;
  dataChannel?: DataChannelOptions;
  mpegtsLoader?: MpegtsLoader;
}

export type MiddlewareKind = 'request' | 'signal' | 'control' | 'resolve';

export interface MiddlewareContext {
  source: Source;
  tech: TechName;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  url?: string;
  action?: string;
  payload?: unknown;
  /** For resolve middleware: resolved sources from EngineAdapter */
  resolvedSources?: ResolvedSources;
  /** For resolve middleware: engine adapter to use */
  adapter?: EngineAdapter;
}

export type MiddlewareResult = Partial<MiddlewareContext>;
export type MiddlewareFn = (ctx: MiddlewareContext) => Promise<MiddlewareResult | void> | MiddlewareResult | void;

export interface MiddlewareEntry {
  kind: MiddlewareKind;
  fn: MiddlewareFn;
  timeoutMs?: number; // optional timeout for control middleware
}

export type PlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

export type PlayerNetworkSeverity = 'fatal' | 'warning' | 'info';

export type PlayerNetworkCode =
  | 'NETWORK_EVENT'
  | 'SOURCE_FALLBACK'
  | 'RECONNECT_ATTEMPT'
  | 'RECONNECT_EXHAUSTED'
  | 'CONNECT_TIMEOUT'
  | 'AUTOPLAY_BLOCKED'
  | 'METADATA_TIMEOUT'
  | 'AUTH_RECOVERY_ATTEMPT'
  | 'AUTH_RECOVERY_SUCCESS'
  | 'AUTH_RECOVERY_FAILED'
  | 'AUTH_RECOVERY_SKIPPED'
  | 'VIDEO_ERROR'
  | 'HLS_WARNING'
  | 'HLS_FATAL'
  | 'DASH_ERROR'
  | 'FMP4_HTTP_ERROR'
  | 'FMP4_WS_CLOSED'
  | 'FMP4_BACKPRESSURE'
  | 'FMP4_QUOTA_EXCEEDED'
  | 'WS_OPEN'
  | 'WS_CLOSE'
  | 'WEBTRANSPORT_OPEN'
  | 'WEBTRANSPORT_CLOSE'
  | 'WS_RAW_FALLBACK_ERROR'
  | 'GB28181_FALLBACK_ERROR'
  | 'GB28181_CONTROL'
  | 'WEBRTC_DISCONNECTED'
  | 'WEBRTC_ICE_STATE'
  | 'WEBRTC_ICE_FAILED'
  | 'WEBRTC_ICE_RESTART'
  | 'WEBRTC_ICE_RESTART_FAILED'
  | 'WEBRTC_ICE_RECONNECT_REQUIRED'
  | 'WEBRTC_SIGNAL_ERROR'
  | 'WEBRTC_SIGNAL_PARSE_ERROR'
  | 'WEBRTC_SIGNAL_WS_OPEN'
  | 'WEBRTC_SIGNAL_WS_CLOSE'
  | 'WEBRTC_SIGNAL_WS_ERROR'
  | 'WEBRTC_SIGNAL_EVENT'
  | 'WEBRTC_WHEP_HTTP_ERROR'
  | 'WEBRTC_WHEP_TIMEOUT'
  | 'WEBRTC_WHEP_ANSWER_ERROR'
  | 'WEBRTC_WHEP_ICE_GATHERING_TIMEOUT'
  | 'WEBRTC_AUDIO_MUTED'
  | 'WEBRTC_OFFER_TIMEOUT'
  | 'WEBRTC_OFFER_ERROR'
  | 'WEBRTC_NOTIFICATION'
  | 'WEBRTC_PLAYLIST'
  | 'ABR_RENDITION'
  | 'ABR_RENDITION_CHANGED'
  | 'ABR_FALLBACK_ERROR'
  | 'AUDIO_DISABLED'
  | 'AUDIO_FALLBACK'
  | 'VIDEO_DECODE_ERROR'
  | 'CATCHUP_DROP'
  | 'JITTER_BUFFER'
  | 'WEBCODECS_CONFIG'
  | 'WEBCODECS_CONFIG_UNSUPPORTED'
  | 'WEBCODECS_FALLBACK';

export type EngineEvent =
  | 'ready'
  | 'play'
  | 'pause'
  | 'ended'
  | 'error'
  | 'buffer'
  | 'tracks'
  | 'levelSwitch'
  | 'stats'
  | 'qos'
  | 'sei'
  | 'network'
  | 'data'
  | 'metadata';

/** Metadata event payload for private data and SEI extraction */
export interface MetadataEvent {
  /** Event type: 'private-data' for KLV/private streams, 'sei' for SEI NAL units */
  type: 'private-data' | 'sei';
  /** Raw bytes of the metadata */
  raw: Uint8Array;
  /** Presentation timestamp in milliseconds */
  pts: number;
  /** Source PID (for private-data events) */
  pid?: number;
  /** SEI payload type number (for sei events) */
  seiType?: number;
}

export interface EngineStats {
  ts: number;
  bitrateKbps?: number;
  fps?: number;
  bufferLevel?: number;
  droppedFrames?: number;
  width?: number;
  height?: number;
  codec?: string;
  audioCodec?: string;
  audioBytesReceived?: number;
  audioPacketsReceived?: number;
  audioPacketsLost?: number;
  rttMs?: number;
  packetLoss?: number;
  jitterMs?: number;
  liveLatencyMs?: number;
  decodeLatencyMs?: number;
  pendingSegments?: number;
  pendingBytes?: number;
  candidateType?: string;
  localCandidateType?: string;
  remoteCandidateType?: string;
  transport?: string;
}

export interface PlayerStatsEvent {
  tech: TechName;
  stats?: EngineStats;
}

export type PlayerQosSeverity = 'warning' | 'info';

export type PlayerQosCode =
  | 'QOS_EVENT'
  | 'PERFORMANCE_BUDGET'
  | 'WEBCODECS_CONFIG'
  | 'WEBCODECS_TS_WARNING'
  | 'WEBCODECS_CONFIG_UNSUPPORTED'
  | 'WEBCODECS_FALLBACK';

export interface PlayerQosEvent {
  type?: string;
  code?: PlayerQosCode | (string & {});
  severity?: PlayerQosSeverity;
  message?: string;
  tech?: TechName;
  ts?: number;
  codec?: string;
  decodedFrames?: number;
  decodeErrors?: number;
  reason?: string;
  [key: string]: unknown;
}

export interface PlayerNetworkEvent {
  type?: string;
  code?: PlayerNetworkCode | (string & {});
  fatal?: boolean;
  severity?: PlayerNetworkSeverity;
  message?: string;
  state?: string;
  timeoutMs?: number;
  attempt?: number;
  maxRetries?: number;
  from?: string;
  to?: string;
  reason?: string;
  errors?: number;
  dropped?: number;
  droppedBytes?: number;
  kept?: number;
  mode?: string;
  pendingSegments?: number;
  pendingBytes?: number;
  maxPendingSegments?: number;
  maxPendingBytes?: number;
  [key: string]: unknown;
}

export interface PlayerLevelSwitchEvent {
  tech?: TechName;
  mediaType?: string;
  from?: number | string | null;
  to?: number | string | null;
  bitrateKbps?: number;
  width?: number;
  height?: number;
  codec?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface QualityLevel {
  /** Stable level id within the active Tech. Use with `setQualityLevel(id)`. */
  id: number | string;
  /** Zero-based level index when the underlying Tech exposes one. */
  index?: number;
  label?: string;
  bitrateKbps?: number;
  width?: number;
  height?: number;
  codec?: string;
  active?: boolean;
}

export interface QualityState {
  supported: boolean;
  tech?: TechName;
  auto: boolean;
  current?: number | string | null;
  levels: QualityLevel[];
}

export interface PlayerEventMap {
  ready: [];
  play: [];
  pause: [];
  ended: [];
  error: [error: unknown];
  buffer: [payload?: unknown];
  tracks: [payload?: unknown];
  levelSwitch: [payload?: PlayerLevelSwitchEvent];
  stats: [payload: PlayerStatsEvent];
  qos: [payload?: PlayerQosEvent];
  sei: [payload?: unknown];
  network: [event: PlayerNetworkEvent | undefined];
  data: [payload?: unknown];
  metadata: [event: MetadataEvent | MetadataDetectedEvent];
  preference: [event: PlayerPreferenceEvent];
  recording: [event: PlayerRecordingEvent];
}

export type PlayerEventHandler<E extends keyof PlayerEventMap> = (...args: PlayerEventMap[E]) => void;

export interface PluginContext {
  player: PlayerAPI;
  coreBus: EventBusLike;
  ui?: UISurface;
  storage?: KeyValueStore | null;
  techs: TechRegistry;
}

export interface PluginLifecycle {
  destroy?: () => void | Promise<void>;
}

export type PluginCtor = (ctx: PluginContext) => void | PluginLifecycle;

export interface PlayerAPI {
  readonly currentTime: number;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(time: number): Promise<void>;
  switchSource(index: number): Promise<void>;
  getQualityState(): QualityState;
  setQualityLevel(level: number | string | 'auto'): Promise<void>;
  getState(): PlayerState;
  getSources(): Source[];
  getCurrentSource(): Source | undefined;
  getVideoElement(): HTMLVideoElement;
  on<E extends keyof PlayerEventMap>(event: E, handler: PlayerEventHandler<E>): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  once<E extends keyof PlayerEventMap>(event: E, handler: PlayerEventHandler<E>): void;
  once(event: string, handler: (...args: unknown[]) => void): void;
  off<E extends keyof PlayerEventMap>(event: E, handler: PlayerEventHandler<E>): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  /** Invoke a tech-specific control action (e.g., gb28181 invite/ptz). */
  control(action: string, payload?: unknown): Promise<unknown>;
  /** Enable ws-raw metadata extraction after detect-only metadata discovery. */
  enableMetadataExtraction(): void;
  /** Disable ws-raw metadata extraction while keeping detection available. */
  disableMetadataExtraction(): void;
  /** Return detected private data PIDs for the active ws-raw tech. */
  getDetectedPrivateDataPids(): number[];
  /** Return detected SEI payload types for the active ws-raw tech. */
  getDetectedSeiTypes(): number[];
}

export interface PlayerPreferenceEvent {
  key: 'volume' | 'muted' | 'playbackRate' | 'quality' | 'lowLatency' | 'sourceIndex' | string;
  value: unknown;
  source?: 'ui' | 'storage' | 'api' | string;
  ts?: number;
}

export type PlayerRecordingStatus =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'stopped'
  | 'error';

export type PlayerRecordingCode =
  | 'RECORDING_HTTP_ERROR'
  | 'RECORDING_TIMEOUT'
  | 'RECORDING_ABORTED'
  | 'RECORDING_REQUEST_ERROR'
  | 'RECORDING_PARSE_ERROR'
  | 'RECORDING_CONFIG_ERROR';

export interface PlayerRecordingErrorInfo {
  code: PlayerRecordingCode;
  message: string;
  action?: 'start' | 'stop' | 'status';
  endpoint?: string;
  status?: number;
  statusText?: string;
  body?: unknown;
  timeoutMs?: number;
  cause?: unknown;
}

export interface PlayerRecordingEvent {
  type:
    | 'recording-starting'
    | 'recording-started'
    | 'recording-stopping'
    | 'recording-stopped'
    | 'recording-status'
    | 'recording-error';
  status: PlayerRecordingStatus;
  active: boolean;
  source?: Source;
  sourceIndex?: number;
  tech?: TechName | null;
  recordingId?: string;
  sessionId?: string;
  response?: unknown;
  error?: PlayerRecordingErrorInfo | unknown;
  code?: PlayerRecordingCode;
  ts: number;
}

// UI and storage interfaces are placeholders for future extension
export interface UISurface {
  registerComponent(name: string, component: unknown): void;
}

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface EventBusLike {
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(event?: string): void;
  emit(event: string, ...args: unknown[]): void;
}

export interface TechRegistry {
  getCurrentTech(): Tech | null;
  getTech(name: TechName): Tech | null;
  getCurrentTechName(): TechName | null;
  getRegisteredTechs(): TechName[];
  register(name: TechName, tech: Tech, options?: TechRegistrationOptions): TechRegistrationHandle;
}

export interface TechRegistrationOptions {
  /** Replace an existing Tech with the same name. Defaults to false. */
  replace?: boolean;
  /**
   * Add the Tech name to Player tech order.
   * Defaults to `append` for new Tech names and `false` for names already present.
   */
  techOrder?: 'prepend' | 'append' | false;
}

export interface TechRegistrationHandle {
  readonly name: TechName;
  unregister(): Promise<void>;
}

export type WebRTCSignalConfig =
  | {
      type: 'oven-ws';
      url: string; // ws:// or wss:// signaling
      streamId: string;
      token?: string;
    }
  | {
      type: 'whip' | 'whep';
      url: string; // http(s)://... WHIP/WHEP endpoint
      token?: string;
      /** Signaling fetch timeout. Defaults to the player reconnect timeout or 15000ms. */
      timeoutMs?: number;
      /** Maximum time to wait for ICE gathering before posting the SDP offer. Defaults to 5000ms. */
      iceGatheringTimeoutMs?: number;
    };

// eslint-disable-next-line @typescript-eslint/no-use-before-define
export interface Tech {
  canPlay(source: Source): boolean;
  load(
    source: Source,
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
      webCodecs?: WebCodecsConfig;
      dataChannel?: DataChannelOptions;
      mpegtsLoader?: MpegtsLoader;
    }
  ): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Seek to specified time. Throws if seeking is not supported for this tech/source. */
  seek(time: number): Promise<void>;
  /** Optional quality/ABR state for adaptive techs. */
  getQualityState?(): QualityState;
  /** Optional manual quality selection. Use "auto" to restore ABR. */
  setQualityLevel?(level: number | string | 'auto'): Promise<void>;
  destroy(): Promise<void>;
  getStats(): EngineStats;
  on<E extends EngineEvent>(event: E, handler: (...args: unknown[]) => void): void;
  off?<E extends EngineEvent>(event: E, handler: (...args: unknown[]) => void): void;
  /** Optional control/invoke hook for tech-specific actions */
  invoke?(action: string, payload?: unknown): Promise<unknown>;
}
