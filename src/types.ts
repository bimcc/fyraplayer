export type TechName = 'webrtc' | 'hls' | 'dash' | 'fmp4' | 'ws-raw' | 'file' | 'gb28181';

/** @deprecated Use 'hls' or 'dash' instead */
export type LegacyTechName = 'hlsdash';

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

/** Base source fields shared by all source types */
interface BaseSourceFields {
  /** Fallback sources to try if this source fails */
  fallbacks?: Source[];
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
  /** Video codec hint for MSE initialization */
  codec?: 'h264' | 'h265' | 'av1';
  /** Audio codec hint */
  audioCodec?: 'aac' | 'opus' | 'mp3';
  /** Whether this is a live stream */
  isLive?: boolean;
  preferTech?: 'fmp4';
};

export type WSRawSource = BaseSourceFields & {
  type: 'ws-raw';
  url: string;
  codec: 'h264' | 'h265';
  transport?: 'flv' | 'ts' | 'annexb' | 'ps';
  heartbeatMs?: number;
  preferTech?: 'ws-raw';
  experimental?: boolean;
  decoderUrl?: string;
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
  gb: {
    deviceId: string;
    channelId: string;
    ssrc?: string;
    transport?: 'udp' | 'tcp';
    expires?: number;
  };
  /** Container format delivered over data channel */
  format?: 'annexb' | 'ts' | 'ps';
  /** Optional codec hints to preconfigure decoders */
  codecHints?: {
    video?: 'h264' | 'h265';
    audio?: 'aac' | 'pcma' | 'pcmu' | 'opus';
    width?: number;
    height?: number;
    sampleRate?: number;
    channels?: number;
  };
  heartbeatMs?: number;
  decoderUrl?: string;
  audioOptional?: boolean;
  /** Use WebTransport datagrams instead of WebSocket */
  webTransport?: boolean;
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

export type Source =
  | WebRTCSource
  | HLSSource
  | DASHSource
  | FMP4Source
  | WSRawSource
  | Gb28181Source
  | FileSource
  | AutoSource;

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
  catchUp?: {
    maxBufferMs?: number;
    maxFrames?: number;
    mode?: 'none' | 'drop-to-key' | 'latest';
  };
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
  ui?: UIOptions;
  plugins?: PluginCtor[];
  middleware?: MiddlewareEntry[];
  metrics?: MetricsOptions;
  buffer?: BufferPolicy;
  reconnect?: ReconnectPolicy;
  webCodecs?: WebCodecsConfig;
  dataChannel?: DataChannelOptions;
}

export interface UIOptions {
  skin?: string;
  layout?: string;
}

export type MiddlewareKind = 'request' | 'signal' | 'control' | 'resolve';

export interface MiddlewareContext {
  source: Source;
  tech: TechName;
  headers?: Record<string, string>;
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
  rttMs?: number;
  packetLoss?: number;
  jitterMs?: number;
  liveLatencyMs?: number;
  decodeLatencyMs?: number;
}

export interface PluginContext {
  player: PlayerAPI;
  coreBus: EventBusLike;
  ui?: UISurface;
  storage?: KeyValueStore | null;
  techs: TechRegistry;
}

export type PluginCtor = (ctx: PluginContext) => void;

export interface PlayerAPI {
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(time: number): Promise<void>;
  switchSource(index: number): Promise<void>;
  getState(): PlayerState;
  getCurrentSource(): Source | undefined;
  /** Invoke a tech-specific control action (e.g., gb28181 invite/ptz). */
  control(action: string, payload?: any): Promise<any>;
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
  on(event: string, listener: (...args: any[]) => void): void;
  once(event: string, listener: (...args: any[]) => void): void;
  off(event: string, listener: (...args: any[]) => void): void;
  removeAllListeners(event?: string): void;
  emit(event: string, ...args: any[]): void;
}

export interface TechRegistry {
  getCurrentTech(): Tech | null;
  getCurrentTechName(): TechName | null;
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
    }
  ): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Seek to specified time. Throws if seeking is not supported for this tech/source. */
  seek(time: number): Promise<void>;
  destroy(): Promise<void>;
  getStats(): EngineStats;
  on<E extends EngineEvent>(event: E, handler: (...args: any[]) => void): void;
  off?<E extends EngineEvent>(event: E, handler: (...args: any[]) => void): void;
  /** Optional control/invoke hook for tech-specific actions */
  invoke?(action: string, payload?: any): Promise<any>;
}
