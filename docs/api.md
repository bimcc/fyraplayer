# FyraPlayer API

通用低延迟 Web 播放器，支持 WebRTC、HLS/DASH、fMP4、WebSocket+WebCodecs、本地文件等多种播放技术。

## 核心类

### FyraPlayer

```typescript
class FyraPlayer implements PlayerAPI {
  constructor(options: PlayerOptions)
  
  // 生命周期
  init(): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  seek(time: number): Promise<void>
  destroy(): Promise<void>
  
  // 状态
  getState(): PlayerState
  getSources(): Source[]
  getCurrentSource(): Source | undefined
  getVideoElement(): HTMLVideoElement
  get currentTime(): number  // 当前播放时间（秒）
  
  // 事件
  on<E extends keyof PlayerEventMap>(event: E, handler: (...args: PlayerEventMap[E]) => void): void
  on(event: string, handler: (...args: unknown[]) => void): void
  once<E extends keyof PlayerEventMap>(event: E, handler: (...args: PlayerEventMap[E]) => void): void
  once(event: string, handler: (...args: unknown[]) => void): void
  off<E extends keyof PlayerEventMap>(event: E, handler: (...args: PlayerEventMap[E]) => void): void
  off(event: string, handler: (...args: unknown[]) => void): void
  
  // 源切换
  switchSource(index: number): Promise<void>
  
  // 控制（Tech 特定操作）
  control(action: string, payload?: unknown): Promise<unknown>
  
  // 元数据提取（ws-raw tech）
  enableMetadataExtraction(): void
  disableMetadataExtraction(): void
  getDetectedPrivateDataPids(): number[]
  getDetectedSeiTypes(): number[]
  
  // 静态方法
  static probeWebCodecs(): Promise<WebCodecsSupport>
}
```

## 类型定义

### TechName

```typescript
type TechName = 'webrtc' | 'hls' | 'dash' | 'fmp4' | 'ws-raw' | 'file' | 'gb28181';
```

### PlayerOptions

```typescript
interface PlayerOptions {
  sources: Source[]
  techOrder?: TechName[]
  autoplay?: boolean
  muted?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  video: HTMLVideoElement | string
  plugins?: PluginCtor[]
  middleware?: MiddlewareEntry[]
  metrics?: MetricsOptions
  buffer?: BufferPolicy
  reconnect?: ReconnectPolicy
  webCodecs?: WebCodecsConfig
  dataChannel?: DataChannelOptions
}
```

UI controls are enabled only through `plugins: [createUiComponentsPlugin(...)]`.

### Source Resolver Middleware

`auto` sources are resolved through `resolve` middleware. The standard engine
integration helper lives in `fyraplayer/plugins/engines`:

```typescript
import { FyraPlayer } from 'fyraplayer';
import {
  createSourceResolverMiddleware,
  registerDefaultEngines
} from 'fyraplayer/plugins/engines';

registerDefaultEngines();

const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'auto',
    engine: 'mediamtx',
    url: 'rtsp://host/app/stream',
    preferTech: 'webrtc'
  }],
  middleware: [
    createSourceResolverMiddleware({
      protocols: ['webrtc', 'll-hls', 'hls'],
      wsRawCodec: 'h264'
    })
  ],
  techOrder: ['webrtc', 'ws-raw', 'hls', 'dash']
});
```

Resolver notes:

- Engine URL conversion stays outside core playback.
- `fallbackChain` from the selected engine is used unless `protocols` overrides it.
- `AutoSource.preferTech` can promote a matching resolved source to primary.
- FLV outputs become stable `ws-raw` MSE sources: `transport: 'flv'`, `pipeline: 'mse'`.
- Explicit `AutoSource.fallbacks` are appended after generated fallbacks.

### UI 插件

```typescript
import { createUiComponentsPlugin } from 'fyraplayer/plugins/ui-components';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/stream.m3u8' }],
  plugins: [
    createUiComponentsPlugin({
      target: '.player-shell',
      showLog: false,
      poster: '/poster.jpg'
    })
  ]
});
```

### Third-party Tech Plugin

External protocols should be added through a plugin, not by patching the
`FyraPlayer` constructor. Register a Tech through `ctx.techs.register()` and
return a lifecycle cleanup that calls the handle's `unregister()`.

```typescript
import type { PluginCtor, Source, Tech } from 'fyraplayer';

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
  async load(source) {
    // Start the custom protocol here.
  },
  async play() {},
  async pause() {},
  async seek(time) {},
  async destroy() {},
  getStats: () => ({ ts: Date.now() }),
  on(event, handler) {
    // Subscribe handler to Tech events.
  },
  off(event, handler) {
    // Optional cleanup for Tech event handlers.
  }
};

export const acmeTechPlugin: PluginCtor = ({ techs }) => {
  const handle = techs.register('acme', acmeTech, {
    techOrder: 'prepend'
  });

  return {
    destroy: () => handle.unregister()
  };
};
```

Registration rules:

- Duplicate Tech names are rejected unless `replace: true` is passed.
- Replacing an active Tech is rejected; replace before playback starts.
- The registration handle is idempotent and should be called from plugin cleanup.
- `techOrder: 'prepend' | 'append' | false` controls how the registered Tech joins player selection.
- Custom Source types must include at least `type`, `url`, and optional `preferTech`.

### WebCodecsSupport

```typescript
interface WebCodecsSupport {
  h264: boolean
  h265: boolean
  av1: boolean
  vp9: boolean
  /** Ordered codec strings that passed isConfigSupported() */
  h264Codecs?: string[]
  h265Codecs?: string[]
}
```

### WebCodecsConfig & WasmDecoderConfig

```typescript
interface WebCodecsConfig {
  enable?: boolean
  allowH265?: boolean
}

interface WasmDecoderConfig {
  enableSharedArrayBuffer?: boolean
  transferFrames?: boolean
  workerThreads?: number
  requireCrossOriginIsolated?: boolean
}
```



### Source 类型

```typescript
type Source = 
  | WebRTCSource 
  | HLSSource 
  | DASHSource 
  | FMP4Source
  | WSRawSource 
  | Gb28181Source 
  | FileSource 
  | AutoSource

interface SourcePresentationConfig {
  mode?: 'normal' | 'panorama'
  projection?: 'equirectangular' | string
  renderer?: 'panoramalite' | string
  textureFlipX?: boolean
  textureFlipY?: boolean
  [key: string]: unknown
}

interface SourceMetadata {
  tags?: string[]
  presentation?: SourcePresentationConfig
  [key: string]: unknown
}

interface BaseSourceFields {
  fallbacks?: Source[]
  request?: SourceRequestConfig
  presentation?: SourcePresentationConfig
  tags?: string[]
  meta?: SourceMetadata
}

// WebRTC 源
interface WebRTCSource {
  type: 'webrtc'
  url: string
  iceServers?: RTCIceServer[]
  forceRelay?: boolean
  signal?: WebRTCSignalConfig
  preferTech?: 'webrtc'
}

// HLS 源
interface HLSSource {
  type: 'hls'
  url: string
  lowLatency?: boolean  // 启用 LL-HLS
  drm?: DRMConfig
  preferTech?: 'hls'
}

// DASH 源
interface DASHSource {
  type: 'dash'
  url: string
  drm?: DRMConfig
  preferTech?: 'dash'
}

// fMP4 直播流（无清单）
interface FMP4Source {
  type: 'fmp4'
  url: string
  transport: 'http' | 'ws'  // HTTP fetch 或 WebSocket
  mimeType?: string
  codec?: 'h264' | 'h265' | 'av1'
  videoCodecString?: string
  audioCodec?: 'aac' | 'opus' | 'mp3'
  audioCodecString?: string
  isLive?: boolean
  preferTech?: 'fmp4'
}

// WebSocket 原始流
interface WSRawSource {
  type: 'ws-raw'
  url: string
  codec: 'h264' | 'h265'
  transport?: 'flv' | 'ts' | 'annexb'
  decoderUrl?: string
  wasm?: WasmDecoderConfig
  heartbeatMs?: number
  metadata?: MetadataConfig
  audioOptional?: boolean
  disableAudio?: boolean
  webTransport?: boolean
  pipeline?: 'mse' | 'experimental'
  preferTech?: 'ws-raw'
}

// 本地/远程文件
interface FileSource {
  type: 'file'
  url: string
  container?: 'ts' | 'mp4' | 'mkv' | 'webm' | 'flv'  // blob URL 必须指定
  metadata?: MetadataConfig
  preferTech?: 'file'
}

// GB28181 gateway adapter
interface Gb28181Source {
  type: 'gb28181'
  url: string
  control: { invite: string; bye: string; ptz?: string; query?: string; keepalive?: string }
  controlRequest?: {
    headers?: Record<string, string>
    credentials?: RequestCredentials
  }
  gb: { deviceId: string; channelId: string }
  responseMapping?: {
    url?: string
    callId?: string
    ssrc?: string
    streamInfo?: string
    streamId?: string
  }
  format?: 'flv' | 'ts'
  preferTech?: 'gb28181'
}
```

### GB28181 快速示例（FyraVMS）

`gb28181` 模式下，`control.invite` 是服务端网关控制接口，不是媒体流地址。播放器不会实现 SIP/RTP/PS 国标协议栈；它会先调用 invite，再从响应里解析后端已经转出的 FLV/TS 播放 URL。

```ts
const source: Gb28181Source = {
  type: 'gb28181',
  url: '',
  control: {
    invite: 'http://localhost:5174/api/v1/gb/channels/34020000001320000001/invite?device_id=34020000001110000001',
    bye:    'http://localhost:5174/api/v1/gb/channels/34020000001320000001/bye?device_id=34020000001110000001',
    ptz:    'http://localhost:5174/api/v1/gb/channels/34020000001320000001/ptz'
  },
  gb: {
    deviceId: '34020000001110000001',
    channelId: '34020000001320000001'
  },
  responseMapping: {
    url: 'play_urls.urls.ws_flv',
    callId: 'stream_id',
    streamId: 'stream_id'
  },
  format: 'flv'
};
```

如果 `invite` 返回 `401 Unauthorized`，通常是控制接口需要鉴权。可以在 `controlRequest.headers` 里传 `Authorization`，或启用 `credentials: 'include'` 发送 cookie。

备注：`examples/basic.html` 里 GB 表单已支持从 Invite URL 自动提取 `device_id` 和 `channelId`（路径 `/api/v1/gb/channels/{channelId}/invite?...`）。

### MetadataConfig

```typescript
interface MetadataConfig {
  privateData?: {
    enable: boolean
    pids?: number[]
    detectOnly?: boolean
  }
  sei?: {
    enable: boolean
    detectOnly?: boolean
  }
}
```

### BufferPolicy

```typescript
interface BufferPolicy {
  targetLatencyMs?: number
  maxBufferMs?: number
  jitterBufferMs?: number
  playoutDelayHintMs?: number
  catchUpMode?: 'drop-b' | 'drop-bp' | 'skip-to-latest'
  fmp4?: FMP4BufferPolicy
}

interface FMP4BufferPolicy {
  maxPendingSegments?: number
  maxPendingBytes?: number
  overflowStrategy?: 'drop-oldest' | 'drop-newest' | 'error'
  quotaCleanupKeepBehindMs?: number
  quotaRetryLimit?: number
}
```

fMP4 uses a bounded pending append queue before `SourceBuffer.appendBuffer()`.
Defaults are conservative for live playback: keep at most 120 queued segments or
64 MiB, drop oldest queued segments on overflow, keep roughly 12 seconds behind
the playhead during quota cleanup, and retry quota cleanup twice before dropping
the failing segment. Products can tune this through `buffer.fmp4`.

For HTTP direct fMP4, `load()` resolves after the HTTP response and MSE
`SourceBuffer` are ready. The response body is then pumped in the background, so
long-lived live streams do not block `player.init()` or source-switch
completion while the stream remains open.

`FMP4_BACKPRESSURE` is emitted when the pending queue exceeds the configured
segment or byte limit. `FMP4_QUOTA_EXCEEDED` is emitted when MSE append runs into
`QuotaExceededError` and cleanup/retry is attempted.

### ReconnectPolicy

```typescript
interface ReconnectPolicy {
  enabled: boolean
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  jitter?: number
  heartbeatMs?: number
  timeoutMs?: number
}
```

## 播放技术 (Tech)

### tech-webrtc

WebRTC 低延迟播放，支持多种信令协议：

| 信令类型 | URL 格式 | 说明 |
|----------|----------|------|
| WHEP | `http(s)://...` | 标准 WHEP 协议 |
| WHIP | `http(s)://...` | 标准 WHIP 协议 |
| Oven-WS | `ws(s)://...` | OvenMediaEngine WebSocket 信令 |

WebRTC audio is rendered only through the attached `HTMLVideoElement`. The
Tech does not force `video.muted = true` and does not create a separate
`AudioContext` output path, so application volume/mute controls remain the
single audio authority.

When a WebRTC audio track exists but remains browser-muted after startup, the
player emits `network.code: 'WEBRTC_AUDIO_MUTED'`. This usually means the
browser did not receive decodable audio packets for the negotiated track. For
MediaMTX, WebRTC browser playback is safest with Opus audio; OBS RTMP output is
often AAC-oriented, while MediaMTX documents a WebRTC-readable OBS path through
RTSP output with `libopus`.

### tech-hls

Normal HLS explicitly uses hls.js buffered live mode. Because hls.js 1.6.x
defaults to low-latency edge chasing, FyraPlayer sets `lowLatencyMode: false`
and `liveSyncMode: 'buffered'` unless the source declares `lowLatency: true`.
Use this default for MediaMTX `/index.m3u8` live playback unless LL-HLS is the
explicit test target.

If local OBS testing produces repeated or layered audio and VLC/FyraPlayer show
the same symptom, check OBS routing before changing player code. The confirmed
local case was OBS desktop/browser audio being captured back into the stream.
Keep only the intended media source audio active, mute/remove desktop or browser
application capture for the playback app, and leave monitoring off unless it is
deliberately required.

HLS/LL-HLS 自适应码率播放：

- 基于 hls.js
- 支持 LL-HLS（通过 `lowLatency: true` 启用）
- Safari 使用原生 HLS 支持

```typescript
{ type: 'hls', url: '...m3u8', lowLatency: true, preferTech: 'hls' }
```

### tech-dash

DASH 自适应码率播放：

- 基于 dash.js
- 支持 ABR 自适应码率

```typescript
{ type: 'dash', url: '...mpd', preferTech: 'dash' }
```

### tech-fmp4

fMP4 直播流播放（无清单文件）：

- 支持 HTTP fetch + MSE
- 支持 WebSocket + MSE
- 适用于无 .m3u8/.mpd 清单的 fMP4 流

```typescript
{ type: 'fmp4', url: '...', transport: 'http', codec: 'h264', preferTech: 'fmp4' }
{ type: 'fmp4', url: 'wss://...', transport: 'ws', codec: 'h264', preferTech: 'fmp4' }
{ type: 'fmp4', url: '/ffmpeg-fmp4/stream.fmp4', transport: 'http', videoCodecString: 'avc1.4d401f', audioCodecString: 'mp4a.40.2', preferTech: 'fmp4' }
```

### tech-ws-raw

WebSocket + WebCodecs 低延迟播放：

- 支持 FLV、TS、AnnexB 容器/比特流
- 自研解复用器，支持 H.264/H.265
- 支持元数据提取（KLV/SEI）
- HTTP-FLV 通过 mpegts.js 回退

- WebCodecs 会从 SPS/VPS 自动构造 codec string；如果配置失败且存在 `decoderUrl`，会回退到 WASM decode


```typescript
{ type: 'ws-raw', url: 'wss://...', codec: 'h264', transport: 'flv', preferTech: 'ws-raw' }
```

Stable contract:

- The default `ws-raw` path is `pipeline: 'mse'`, implemented through `mpegts.js` + browser MSE. This is the current commercial/default path.
- `pipeline: 'experimental'` opts into the in-house WebCodecs/WASM path. It can emit additional diagnostics and may fall back to MSE on startup or decode failure.
- `pipeline: 'experimental'` is the only supported opt-in for the in-house WebCodecs/WASM path.
- Metadata extraction from TS is tied to the experimental demux pipeline. Do not treat metadata extraction as part of the stable MSE-only contract until it has its own verified path.

```typescript
// Stable default path
{ type: 'ws-raw', url: 'https://example.com/live.flv', codec: 'h264', transport: 'flv', pipeline: 'mse' }

// Explicit experimental path
{ type: 'ws-raw', url: 'wss://example.com/live.ts', codec: 'h264', transport: 'ts', pipeline: 'experimental' }
```

### tech-file

本地/远程文件播放：

| 格式 | 播放方式 | 说明 |
|------|----------|------|
| MP4 | 原生 video.src | 浏览器原生支持 |
| TS | mpegts.js | MSE 播放 |
| FLV | mpegts.js | MSE 播放 |
| blob: URL | 根据 container hint | 本地文件需指定 container 类型 |

TS + WebCodecs now derives codec strings from SPS/VPS and falls back to mpegts.js when unsupported.

```typescript
// 本地 TS 文件播放示例
{ type: 'file', url: blobUrl, container: 'ts', preferTech: 'file' }
```

### tech-gb28181

GB28181 网关适配：

- 支持 Invite/Bye 控制
- 支持 PTZ 云台控制入口：播放器只调用后端网关，不直接控制摄像机
- 支持 query/keepalive 控制
- 媒体面只播放后端返回的标准 FLV/TS URL
- 不在浏览器端实现 SIP/RTP/PS/G.711 国标协议栈

PTZ 的真实设备控制属于服务端 GB28181 网关或厂商/ONVIF 控制服务。播放器端 `player.control('gb:ptz', payload)` 只负责把 UI/业务意图和当前会话字段提交给网关；权限、预置位映射、云台状态、协议 XML/SIP MESSAGE、设备执行结果都应由后端处理。

## 事件列表

| 事件 | 参数 | 说明 |
|------|------|------|
| `ready` | - | 播放器就绪 |
| `play` | - | 开始播放 |
| `pause` | - | 暂停播放 |
| `ended` | - | 播放结束 |
| `error` | `Error` | 发生错误 |
| `buffer` | `{ level: number }` | 缓冲状态变化 |
| `stats` | `{ tech: TechName, stats: EngineStats }` | 播放统计 |
| `network` | `PlayerNetworkEvent` | 网络状态变化 |
| `metadata` | `MetadataEvent \| MetadataDetectedEvent` | 元数据（KLV/SEI）或 detect-only 发现事件 |
| `levelSwitch` | `{ level: number }` | 码率切换 |

Note: `levelSwitch` now uses `PlayerLevelSwitchEvent`. The old `{ level: number }`
table entry is retained only because this legacy document contains mixed
encoding text; consumers should use the typed event contract below.

### MetadataEvent

```typescript
interface MetadataEvent {
  type: 'private-data' | 'sei'
  raw: Uint8Array
  pts: number
  pid?: number      // private-data 的 PID
  seiType?: number  // SEI payload 类型
}
```

```typescript
interface MetadataDetectedEvent {
  type: 'private-data-detected' | 'sei-detected'
  pids?: number[]
  streamTypes?: Map<number, number>
  seiTypes?: number[]
}
```

### PlayerNetworkEvent

```typescript
interface PlayerNetworkEvent {
  type?: string
  code?: PlayerNetworkCode | string
  fatal?: boolean
  severity?: 'fatal' | 'warning' | 'info'
  message?: string
  [key: string]: unknown
}
```

`type` keeps the original Tech event name for debugging. Product integrations
should branch on `code`, which is normalized at the Player boundary for Tech
events, source fallback events, and Player-owned reconnect events.
Unknown custom Tech events keep their original `type` and receive
`code: 'NETWORK_EVENT'` unless the Tech supplies its own stable `code`.

Common stable codes:

| Code | Typical source |
|---|---|
| `HLS_WARNING` / `HLS_FATAL` | hls.js non-fatal/fatal errors |
| `DASH_ERROR` | dash.js non-fatal errors |
| `SOURCE_FALLBACK` | primary source failed and fallback source loaded |
| `RECONNECT_ATTEMPT` / `RECONNECT_EXHAUSTED` | Player reconnect policy |
| `AUTH_RECOVERY_ATTEMPT` / `AUTH_RECOVERY_SUCCESS` / `AUTH_RECOVERY_FAILED` / `AUTH_RECOVERY_SKIPPED` | optional auth recovery plugin lifecycle |
| `CONNECT_TIMEOUT` / `METADATA_TIMEOUT` / `AUTOPLAY_BLOCKED` | browser/runtime playback warnings |
| `WEBRTC_ICE_FAILED` / `WEBRTC_ICE_RESTART` / `WEBRTC_ICE_RECONNECT_REQUIRED` / `WEBRTC_SIGNAL_ERROR` | WebRTC connection, ICE recovery, and signaling |
| `WEBRTC_SIGNAL_WS_OPEN` / `WEBRTC_SIGNAL_WS_CLOSE` / `WEBRTC_SIGNAL_WS_ERROR` | WebRTC signaling WebSocket events |
| `WEBRTC_AUDIO_MUTED` | WebRTC audio track exists but the browser reports it muted/no audio packets |
| `WS_RAW_FALLBACK_ERROR` / `AUDIO_FALLBACK` / `VIDEO_DECODE_ERROR` | ws-raw pipeline diagnostics |
| `FMP4_HTTP_ERROR` / `FMP4_WS_CLOSED` | fMP4 transport failures |
| `FMP4_BACKPRESSURE` / `FMP4_QUOTA_EXCEEDED` | fMP4 pending queue overflow and MSE quota cleanup |
| `GB28181_FALLBACK_ERROR` / `GB28181_CONTROL` | GB28181 adapter diagnostics |

### PlayerLevelSwitchEvent

```typescript
interface PlayerLevelSwitchEvent {
  tech?: TechName
  mediaType?: string
  from?: number | string | null
  to?: number | string | null
  bitrateKbps?: number
  width?: number
  height?: number
  codec?: string
  reason?: string
  [key: string]: unknown
}
```

### QualityState

HLS and DASH expose adaptive-bitrate state through the public Player API.

```typescript
interface QualityLevel {
  id: number | string
  index?: number
  label?: string
  bitrateKbps?: number
  width?: number
  height?: number
  codec?: string
  active?: boolean
}

interface QualityState {
  supported: boolean
  tech?: TechName
  auto: boolean
  current?: number | string | null
  levels: QualityLevel[]
}

player.getQualityState(): QualityState
await player.setQualityLevel('auto') // restore ABR
await player.setQualityLevel(0)      // manual level by id or index
```

`getQualityState()` returns `supported: false` when the active Tech does not
support public quality selection. The optional UI plugin prefers this Tech-level
quality state; only when no adaptive levels exist does the selector fall back to
multi-source switching.

`getVideoElement()` exposes the player-owned media element for optional renderer
plugins and host integrations. Consumers may read layout/media state from it,
but playback lifecycle, source loading, reconnect, and audio ownership should
remain with `FyraPlayer` and the active Tech.

### HLS/DASH Event Semantics

Current stable contract:

- `ready` is emitted once per Tech load after the Tech has browser/media readiness evidence. For HLS this is currently tied to buffered fragment readiness or native metadata/canplay. For DASH this is tied to dash.js `CAN_PLAY` / metadata readiness or the video element's `loadedmetadata` / `canplay`.
- HLS non-fatal hls.js errors are emitted as `network` events with `type: 'hls-warning'` and `severity: 'warning'`; they do not emit player `error`.
- HLS fatal hls.js errors emit player `error` and a fatal `network` event with `type: 'hls-fatal'`.
- DASH non-fatal dash.js errors are emitted as `network` events with `type: 'dash-error'`.
- DASH fatal dash.js errors emit player `error`.
- `levelSwitch` uses `PlayerLevelSwitchEvent`; HLS/DASH payloads are normalized to small stable objects instead of third-party library internals.
- HLS/DASH quality selection uses `getQualityState()` and `setQualityLevel()`. Passing `'auto'` restores ABR; numeric values select a Tech level index.

Do not depend on raw hls.js or dash.js event payload objects from public player events. If a product needs library-specific diagnostics, add a diagnostics plugin rather than parsing public playback events.

### EngineStats

```typescript
interface EngineStats {
  ts: number
  bitrateKbps?: number
  fps?: number
  bufferLevel?: number
  droppedFrames?: number
  width?: number
  height?: number
  codec?: string
  audioCodec?: string
  rttMs?: number
  packetLoss?: number
  jitterMs?: number
  liveLatencyMs?: number
  decodeLatencyMs?: number
  pendingSegments?: number
  pendingBytes?: number
}
```

### PlayerStatsEvent

```typescript
interface PlayerStatsEvent {
  tech: TechName
  stats?: EngineStats
}
```

`stats` is emitted by the Player at `metrics.statsIntervalMs` and wraps the
active Tech snapshot with the Tech name. The inner `stats` shape remains
`EngineStats`.

### PlayerQosEvent

```typescript
interface PlayerQosEvent {
  type?: string
  code?: PlayerQosCode | string
  severity?: 'warning' | 'info'
  message?: string
  tech?: TechName
  ts?: number
  codec?: string
  decodedFrames?: number
  decodeErrors?: number
  reason?: string
  [key: string]: unknown
}
```

`qos` keeps the raw Tech `type` and adds stable fields at the Player boundary:
`code`, `severity`, `message`, `tech`, and `ts`. Known codes currently cover
WebCodecs configuration, fallback diagnostics, and optional performance-budget warnings:

| Code | Meaning |
|---|---|
| `WEBCODECS_CONFIG` | WebCodecs configured successfully |
| `WEBCODECS_TS_WARNING` | TS WebCodecs path decoded with recoverable errors |
| `WEBCODECS_CONFIG_UNSUPPORTED` | WebCodecs configuration was rejected or unsupported |
| `WEBCODECS_FALLBACK` | Playback fell back from WebCodecs to another path |
| `PERFORMANCE_BUDGET` | Optional performance monitor plugin detected a budget violation |
| `QOS_EVENT` | Unknown custom QoS event |

## Performance Monitor Plugin

Performance monitoring is optional and lives outside core playback:

```typescript
import { createPerformanceMonitorPlugin } from 'fyraplayer/plugins/performance';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/stream.m3u8' }],
  metrics: { statsIntervalMs: 1000 },
  plugins: [
    createPerformanceMonitorPlugin({
      budget: {
        minFps: 24,
        maxDecodeLatencyMs: 80,
        maxLiveLatencyMs: 5000,
        maxPendingBytes: 64 * 1024 * 1024
      },
      budgetsByTech: {
        webrtc: { maxRttMs: 800 },
        fmp4: { maxPendingSegments: 120 }
      },
      onSample: (sample) => console.debug(sample.tech, sample.fps),
      onViolation: (violation) => console.warn(violation.code, violation.message)
    })
  ]
});
```

The plugin consumes public `stats` events, creates `PerformanceSample` objects,
and reports `PerformanceViolation` records. By default it also emits `qos`
events with `code: 'PERFORMANCE_BUDGET'`. It does not change ABR, reconnect, or
Tech selection behavior. Budget evaluation defaults to Player state `playing`;
samples are still reported while paused/idle, but violations are not evaluated
unless `evaluationMode: 'always'` is configured.

Use [docs/performance-baseline.md](./performance-baseline.md) for the current
default budgets and remaining profiling evidence.

## Diagnostics Plugin

Diagnostics are optional and intended for support, QA, and product debug
surfaces. The plugin listens to public player events and exposes a snapshot plus
JSON export. It does not control playback, reconnect, quality, or source
selection.

```typescript
import { createDiagnosticsPlugin } from 'fyraplayer/plugins/diagnostics';

let diagnostics: DiagnosticsHandle | undefined;

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'webrtc', url: 'https://example.com/live/whep' }],
  plugins: [
    createDiagnosticsPlugin({
      maxEvents: 200,
      onHandle: (handle) => {
        diagnostics = handle;
      },
      onSnapshot: (snapshot) => {
        console.debug(snapshot.state, snapshot.tech, snapshot.latestNetwork?.code);
      }
    })
  ]
});

// Support export button:
const json = diagnostics?.exportJson();
```

The snapshot includes:

- current player state, active Tech, current source, and source index;
- current quality state when available;
- latest `stats`, `network`, `qos`, and `error` payloads;
- reconnect attempt/exhaustion counters;
- WebRTC ICE state, signaling stage, and audio-muted clue when observed;
- buffer level and fMP4 pending queue clues when present;
- bounded recent event history.

For a built-in visual support surface, enable the debug panel wrapper:

```typescript
import { createDebugPanelPlugin } from 'fyraplayer/plugins/diagnostics';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/live.m3u8' }],
  plugins: [
    createDebugPanelPlugin({
      target: '.player-shell',
      maxEvents: 200
    })
  ]
});
```

The panel is intentionally lightweight. It shows state, Tech, source, URL,
quality, FPS/bitrate, buffer/pending clues, latest network/QoS codes,
reconnect counters, ICE state, recent event count, and buttons for JSON export
and clearing the in-memory event history. Product applications can hide this
panel in production and use `createDiagnosticsPlugin()` directly for custom
support consoles.

## Auth Signing And Recovery

Commercial streams are usually not public bare URLs. Use the optional auth
middleware helper to inject headers, credentials, bearer or custom tokens, and
URL signatures before a source is loaded or before WebRTC WHEP/WHIP signaling
runs:

```typescript
import { FyraPlayer } from 'fyraplayer';
import {
  createAuthRecoveryPlugin,
  createAuthSigningMiddleware
} from 'fyraplayer/plugins/auth';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/live.m3u8' }],
  middleware: createAuthSigningMiddleware({
    headers: { 'x-project': 'demo' },
    credentials: 'include',
    token: async () => ({
      token: await getAccessToken(),
      expiresAt: Date.now() + 55_000
    }),
    signUrl: ({ url }) => signPlaybackUrl(url),
    refreshHeaders: ({ headers }) => ({
      ...headers,
      'x-request-id': crypto.randomUUID()
    })
  }),
  plugins: [
    createAuthRecoveryPlugin({
      maxRetries: 1,
      cooldownMs: 5000,
      refresh: () => refreshAccessToken()
    })
  ]
});
```

By default the helper runs in both `request` and `signal` middleware stages.
Use `kinds: ['request']` or `kinds: ['signal']` to narrow the scope. Token
injection defaults to `Authorization: Bearer <token>`; set `tokenHeader` and
`tokenPrefix: ''` for custom raw-token schemes.

The resulting `source.request` config is consumed by:

- HLS: headers and credentials for hls.js XHR/fetch requests;
- direct HTTP fMP4: headers and credentials for `fetch`;
- WebRTC WHEP/WHIP signaling: headers and credentials for signaling `fetch`;
- DASH: custom headers are passed to dash.js; credentials remain adapter/browser
  dependent and need real deployment validation before being promised.

This helper is middleware, not a runtime plugin passed through `plugins`,
because the current `PluginContext` cannot register middleware after
`FyraPlayer` construction. That boundary keeps auth/signing policy optional
without expanding core playback.

`createAuthRecoveryPlugin()` is the runtime recovery companion. By default it
listens for public `network` or `error` payloads that clearly carry HTTP
`401` or `403`, calls the optional `refresh()` hook, then reloads the current
source through `player.switchSource(currentIndex)`. That reload runs the normal
resolver and auth/signing middleware chain again, so refreshed tokens and URL
signatures are applied without adding auth policy to the core player.

Recovery is intentionally narrow:

- default matching is only explicit `401` / `403`;
- product integrations can pass `match(trigger, context)` for custom backend
  payloads such as `{ code: 'TOKEN_EXPIRED' }`;
- `maxRetries`, `cooldownMs`, and in-flight guards prevent retry storms;
- `onRecovery` receives `attempt`, `success`, `failed`, and `skipped` phases;
- the plugin emits stable `network.code` values:
  `AUTH_RECOVERY_ATTEMPT`, `AUTH_RECOVERY_SUCCESS`,
  `AUTH_RECOVERY_FAILED`, and `AUTH_RECOVERY_SKIPPED`.

This is not a universal auth backend. The application still owns token storage,
refresh endpoints, cookie policy, source resolution semantics, and whether a
non-HTTP signal should count as token expiry.

## Backend Recording API Plugin

FyraPlayer does not implement browser-side local recording. For monitoring,
VMS, and live operations, prefer server-side recording and connect the UI
recording toggle to `createRecordingApiPlugin()`:

```typescript
import { FyraPlayer } from 'fyraplayer';
import { createRecordingApiPlugin, type RecordingApiHandle } from 'fyraplayer/plugins/recording-api';
import { createUiComponentsPlugin } from 'fyraplayer/plugins/ui-components';

let recording: RecordingApiHandle | undefined;

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/live.m3u8' }],
  plugins: [
    createRecordingApiPlugin({
      startUrl: 'https://api.example.com/recordings/start',
      stopUrl: ({ recordingId }) => `https://api.example.com/recordings/${recordingId}/stop`,
      statusUrl: 'https://api.example.com/recordings/status',
      headers: () => ({ Authorization: `Bearer ${getToken()}` }),
      credentials: 'include',
      onHandle: (handle) => {
        recording = handle;
      }
    }),
    createUiComponentsPlugin({
      target: '.player-shell',
      showRecordingButton: true,
      onRecordToggle: ({ recording: requested }) =>
        requested ? recording?.start() : recording?.stop()
    })
  ]
});
```

The plugin emits typed `recording` events with status, active flag, source,
Tech, recording id, session id, response, and structured error fields. It only
calls the configured backend endpoints. It does not use `captureStream()`,
`MediaRecorder`, canvas recording, or browser file storage.

Recording error events include `code` plus `error` details when available:

| Code | Meaning |
|---|---|
| `RECORDING_HTTP_ERROR` | Backend returned a non-2xx status. Includes status, status text, endpoint, action, and a bounded response body summary. |
| `RECORDING_TIMEOUT` | Backend call exceeded `timeoutMs`. |
| `RECORDING_ABORTED` | In-flight request was aborted by plugin teardown or a newer recording call. |
| `RECORDING_REQUEST_ERROR` | Fetch or another request-layer failure occurred. |
| `RECORDING_PARSE_ERROR` | Backend response succeeded but parsing failed. |
| `RECORDING_CONFIG_ERROR` | Required endpoint is missing or the handle is used after destroy. |

`RecordingApiError` is thrown from `start()`, `stop()`, and `status()` failures.
Its `info` field matches the `PlayerRecordingErrorInfo` shape emitted on the
`recording` event, so products can show concise UI feedback while exporting the
same object for diagnostics.

## PanoramaLite Plugin

`panoramalite` is an optional first-party WebGL2 equirectangular panorama
renderer. It is not a playback Tech: FyraPlayer still owns loading, audio,
quality selection, reconnect, and source switching. The plugin consumes the
player video element or an image and renders it to a WebGL2 canvas.

```typescript
import { FyraPlayer } from 'fyraplayer';
import { createPanoramaLitePlugin } from 'fyraplayer/plugins/panoramalite';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/live360.m3u8' }],
  plugins: [
    createPanoramaLitePlugin({
      target: '.player-shell',
      media: 'video',
      projection: 'equirectangular',
      interactive: true,
      viewerControls: true,
      initialView: { yaw: 0, pitch: 0, fov: 80 },
      maxPixelRatio: 1.5,
      powerPreference: 'high-performance'
    })
  ]
});
```

The plugin also supports panoramic images:

```typescript
createPanoramaLitePlugin({
  target: '.pano',
  media: 'image',
  image: '/assets/panorama.jpg',
  onReady: (handle) => handle.setView({ yaw: 45 })
});
```

Key options:

```typescript
interface PanoramaLitePluginOptions {
  target?: HTMLElement | string
  media?: 'video' | 'image'
  image?: string | HTMLImageElement | ImageBitmap
  projection?: 'equirectangular'
  enabled?: boolean
  interactive?: boolean
  viewerControls?: boolean | PanoramaLiteViewerControlsOptions
  initialView?: Partial<PanoramaLiteView>
  limits?: Partial<PanoramaLiteViewLimits>
  pixelRatio?: number | 'auto'
  maxPixelRatio?: number
  maxCanvasPixels?: number
  maxVideoFps?: number
  powerPreference?: WebGLPowerPreference
  textureFlipX?: boolean
  textureFlipY?: boolean
  preserveDrawingBuffer?: boolean
  crossOrigin?: '' | 'anonymous' | 'use-credentials'
  hideSourceVideo?: boolean
  className?: string
  onReady?: (handle: PanoramaLiteHandle) => void
  onError?: (error: unknown) => void
}

interface PanoramaLiteViewerControlsOptions {
  enabled?: boolean
  playback?: boolean
  seek?: boolean
  loop?: boolean
  volume?: boolean
  fullscreen?: boolean
  resetView?: boolean
  className?: string
}
```

`presentation` is source-platform metadata for product surfaces, not a playback
Tech selector. Use it when a catalog/stream API knows that a source should open
in panorama mode:

```ts
import { getSourcePresentation, isPanoramaSource } from 'fyraplayer';

const source: Source = {
  type: 'hls',
  url: 'https://example.com/live360.m3u8',
  presentation: {
    mode: 'panorama',
    projection: 'equirectangular',
    renderer: 'panoramalite',
    textureFlipX: false,
    textureFlipY: false
  },
  tags: ['panorama']
};

if (isPanoramaSource(source)) {
  const presentation = getSourcePresentation(source);
  // install/enable PanoramaLite and apply presentation texture options
}
```

`source.presentation` is the recommended direct contract. `source.meta.presentation`
and platform tags such as `panorama`, `360`, or `equirectangular` are also
recognized by `getSourcePresentation()` for integrations that mirror an upstream
API response shape. Source resolver middleware preserves this metadata when an
`auto` source is converted into concrete HLS/DASH/WebRTC fallback sources.

`PanoramaLiteHandle` exposes `setEnabled()`, `isEnabled()`, `setView()`,
`getView()`, `resetView()`, `bindVideo()`, `setImage()`, `setInteractive()`,
`resize()`, and `destroy()`.
The plugin emits QoS codes such as `PANORAMALITE_UNSUPPORTED`,
`PANORAMALITE_READY`, `PANORAMALITE_RENDER_ERROR`,
`PANORAMALITE_CONTEXT_LOST`, `PANORAMALITE_CONTEXT_RESTORED`, and
`PANORAMALITE_TEXTURE_ERROR`.

Plugin installation and panorama mode are intentionally separate. If the plugin
is installed when the player is created, it can bind the current video element
and a product can expose a runtime "panorama mode" toggle without reloading the
stream. Use `enabled: false` to start in ordinary video mode, then call
`handle.setEnabled(true)` to switch the current media into panorama rendering.
If the plugin is not installed on that player instance, the current public API
does not support hot plugin installation; use deployment-level plugin
configuration or recreate the player with the plugin enabled.

For catalog/platform-driven playback, prefer source-level presentation metadata:
`source.presentation.mode = 'panorama'` plus
`projection: 'equirectangular'`. The main demo reads this metadata through
`isPanoramaSource()` / `getSourcePresentation()` and automatically switches the
visible player surface from the ordinary UI shell to PanoramaLite viewer
controls. Frame-level SEI/KLV or container metadata can still be parsed by
domain plugins, but it should not be the primary trigger for initial panorama
mode because it arrives after source selection and differs by protocol.

The default interaction model is screen-oriented. Pointer/touch controls change
yaw/pitch and wheel/pinch changes fov; they do not change roll/Z-axis rotation,
so normal screen interaction keeps `PanoramaLiteView.roll` unchanged.
Programmatic `setView({ roll })` remains available for future
gyro/device-orientation, WebXR, or product-owned orientation integrations.
Those modes are not implemented in the current plugin and should be treated as
future opt-in work.

For live/WebRTC panorama scenes, the default strategy preserves quality:
PanoramaLite skips duplicate video frames, uploads textures only for real new
frames, coalesces work through `requestAnimationFrame()`, avoids per-frame
layout reads, disables `preserveDrawingBuffer`, and requests a high-performance
WebGL context. `maxVideoFps`, `maxCanvasPixels`, and lower `maxPixelRatio`
values are explicit fallback knobs for constrained devices or dense
multi-view dashboards.

`viewerControls` is optional and disabled by default. Enable it when the
panorama canvas needs its own fullscreen-friendly controls for play/pause, seek
on finite media, loop, mute/volume, reset view, and fullscreen. The default
style is a lightweight bottom floating control cluster, not a full-width bar;
live streams hide seek, loop, the live label, and the volume slider to reduce
picture occlusion. The built-in play/pause buttons call FyraPlayer's
`PlayerAPI`, so application middleware and state transitions remain the single
playback authority.

`textureFlipX` and `textureFlipY` are source-orientation corrections. Image
and video sources default to `textureFlipX: false` and `textureFlipY: false`;
the generated demo grid is the zero-flip orientation baseline. Use the
generated demo grid to
confirm upside-down or mirrored streams before overriding them. Browser pixel
evidence for image, file/video, HLS, live HLS, and live WebRTC is tracked in
`docs/panoramalite.md`.

## Storage And Reconnect Plugins

Utility plugins are optional and lifecycle-safe:

```typescript
import { createStoragePlugin } from 'fyraplayer/plugins/storage';
import { createReconnectPlugin } from 'fyraplayer/plugins/reconnect';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/stream.m3u8' }],
  plugins: [
    createStoragePlugin({
      key: 'fyra:lastSource',
      preferencesKey: 'fyra:preferences',
      restoreSource: true,
      persistSource: true,
      persistVolume: true,
      persistMuted: true,
      persistPlaybackRate: true,
      persistQuality: true,
      persistLowLatency: true,
      video: '#video'
    }),
    createReconnectPlugin({
      logNetwork: false,
      logError: false,
      onNetwork: (event) => reportNetwork(event),
      onError: (error) => reportError(error)
    })
  ]
});
```

Use `createStoragePlugin()` and `createReconnectPlugin()` so callbacks, logging,
and storage keys are explicit. Both factories return plugin lifecycles that
detach listeners during Player destroy/plugin unregister.

Storage preference notes:

- `key` stores the source index for simple integrations.
- `preferencesKey` stores structured playback preferences as JSON.
- Volume, muted state, playback speed, quality mode, low-latency preference, and
  source index are opt-in so products can decide what should persist.
- UI controls emit `preference` events for volume, muted state, playback speed,
  quality selection, and source selection; non-UI integrations can emit the same
  event on the core bus through their own plugin.
- `persistQuality` reapplies the saved quality after `ready`; unsupported Techs
  ignore the restore attempt.
- `persistLowLatency` mutates HLS source objects before load and on preference
  updates. Treat it as an app preference for demo/product presets, not as proof
  that every stream should run in LL-HLS mode.

## UI Product Controls

`createUiComponentsPlugin()` is still optional, but it now includes the product
UI baseline for interruption/reconnect states, preference-friendly controls, a
diagnostics entry point, screenshot feedback, and an optional recording toggle
hook:

```typescript
import {
  createUiComponentsPlugin,
  type UiRecordToggleEvent,
  type UiScreenshotEvent
} from 'fyraplayer/plugins/ui-components';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/live.m3u8' }],
  plugins: [
    createUiComponentsPlugin({
      target: '.player-shell',
      showStatusOverlay: true,
      onRetry: () => player.play(),
      onDiagnostics: ({ player }) => {
        console.log(player.getState());
      },
      onScreenshot: (event: UiScreenshotEvent) => {
        console.log(event.filename, event.width, event.height);
      },
      showRecordingButton: true,
      onRecordToggle: (event: UiRecordToggleEvent) => {
        console.log(event.recording ? 'recording requested' : 'recording stopped');
      }
    })
  ]
});
```

The status layer shows generic stream interruption text, network/retry details
when available, and a retry button after reconnect exhaustion. It deliberately
stays generic instead of trying to classify live/VOD because the public source
contract does not expose a universal live flag for every Tech yet.

The diagnostics button is shown automatically when `onDiagnostics` is provided,
or explicitly with `showDiagnosticsButton: true`. Screenshot uses the browser
canvas path, downloads a PNG, and calls `onScreenshot` with the captured `Blob`,
dimensions, filename, player, and video element. Cross-origin streams can still
block canvas capture unless the media response and element CORS mode allow it.

`showRecordingButton` only exposes a UI toggle and calls `onRecordToggle`; it
does not implement recording by itself. Products should connect that hook to
`createRecordingApiPlugin()` or another backend recording adapter. Browser-side
front-end recording is intentionally out of scope for this project.

## WebRTC WHEP/WHIP Hardening Notes

WebRTC sources can pass STUN/TURN and signaling timeout settings directly:

```typescript
const source = {
  type: 'webrtc',
  url: 'https://example.com/live/whep',
  iceServers: [
    { urls: 'stun:stun.example.com:3478' },
    { urls: 'turn:turn.example.com:3478?transport=tcp', username: 'user', credential: 'secret' }
  ],
  forceRelay: true,
  signal: {
    type: 'whep',
    url: 'https://example.com/live/whep',
    timeoutMs: 15000,
    iceGatheringTimeoutMs: 5000
  }
};
```

`timeoutMs` bounds the WHEP/WHIP signaling POST. `iceGatheringTimeoutMs`
bounds local ICE gathering before posting the current SDP offer. Non-2xx WHEP
responses, signaling timeouts, answer SDP failures, and ICE gathering timeout
warnings are normalized into `network.code` values such as
`WEBRTC_WHEP_HTTP_ERROR`, `WEBRTC_WHEP_TIMEOUT`,
`WEBRTC_WHEP_ANSWER_ERROR`, and `WEBRTC_WHEP_ICE_GATHERING_TIMEOUT`.

`iceServers` is passed directly into `RTCPeerConnection`. Set
`forceRelay: true` when the deployment requires TURN-only media, such as restricted
enterprise networks or TCP relay validation. FyraPlayer does not own TURN
credentials or rotation; product middleware should resolve short-lived TURN
servers before constructing the WebRTC source.

ICE recovery behavior is split by severity:

- `iceConnectionState: "disconnected"` emits `WEBRTC_ICE_STATE`, waits for a
  short reconnect grace period, calls `restartIce()` when available, then emits
  fatal `WEBRTC_ICE_RECONNECT_REQUIRED` if the browser did not recover. The
  player-level reconnect path reloads the source so WHEP/WHIP can renegotiate.
- `iceConnectionState: "failed"` emits fatal `WEBRTC_ICE_FAILED` immediately.
  WHEP/WHIP one-shot signaling still relies on the player reload path for a
  fresh offer/answer exchange.

This contract is covered by TypeScript/Jest tests. Real deployment promotion
still requires browser evidence for an Opus-capable audio path, TURN/relay
connectivity, controlled MediaMTX interruption recovery, Edge published-stream
playback, and long-run behavior. Edge abnormal-response handling is already
covered for MediaMTX WHEP `404 no stream is available`.

## 格式检测工具

FyraPlayer 提供格式检测工具，可根据 URL、Content-Type 或文件头自动识别格式：

```typescript
import { detectFormatFromUrl, detectFormatFromBytes, autoDetectSourceType } from 'fyraplayer';

// URL 检测
const format = detectFormatFromUrl('https://example.com/stream.m3u8');
// { container: 'hls', recommendedTech: 'hls', isLive: true, confidence: 'high' }

// 自动检测源类型
const sourceType = autoDetectSourceType('wss://server/stream.flv');
// 'ws-raw'

// 字节检测（魔数）
const bytes = new Uint8Array([0x46, 0x4C, 0x56, ...]); // FLV header
const format = detectFormatFromBytes(bytes);
// { container: 'flv', recommendedTech: 'ws-raw', isLive: true, confidence: 'high' }
```

## 使用示例

### 基础播放

```typescript
import { FyraPlayer } from 'fyraplayer';

const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'hls',
    url: 'https://example.com/stream.m3u8'
  }],
  techOrder: ['hls', 'dash', 'ws-raw', 'file'],
  autoplay: true,
  muted: true
});

player.on('ready', () => console.log('Player ready'));
player.on('error', (err) => console.error('Error:', err));

await player.init();
```

### 多源回退

```typescript
const player = new FyraPlayer({
  video: '#video',
  sources: [
    { type: 'webrtc', url: 'wss://server/webrtc', preferTech: 'webrtc' },
    { type: 'hls', url: 'https://server/stream.m3u8', preferTech: 'hls' }
  ],
  techOrder: ['webrtc', 'hls', 'dash']
});
```

### 本地文件播放

```typescript
const fileInput = document.getElementById('file-input');
fileInput.onchange = async () => {
  const file = fileInput.files[0];
  const blobUrl = URL.createObjectURL(file);
  const ext = file.name.split('.').pop().toLowerCase();
  
  const container = ext === 'ts' || ext === 'mts' ? 'ts' : 
                    ext === 'mp4' || ext === 'm4v' ? 'mp4' : undefined;
  
  const player = new FyraPlayer({
    video: '#video',
    sources: [{
      type: 'file',
      url: blobUrl,
      container  // blob URL 必须指定 container
    }]
  });
  
  await player.init();
};
```

### WebSocket 原始流 + 元数据提取

```typescript
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://server/stream',
    codec: 'h264',
    transport: 'ts',
    metadata: {
      privateData: { enable: true },
      sei: { enable: true }
    }
  }]
});

player.on('metadata', (evt) => {
  if (evt.type === 'private-data') {
    console.log('KLV data:', evt.raw, 'PID:', evt.pid);
  }
});
```

## 与 @aspect/openklv 集成

```typescript
import { FyraPlayer } from 'fyraplayer';
import { KLVParser, SyncEngine } from '@aspect/openklv';

const parser = new KLVParser();
const syncEngine = new SyncEngine();

const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://server/stream',
    codec: 'h264',
    transport: 'ts',
    metadata: { privateData: { enable: true } }
  }]
});

player.on('metadata', (evt) => {
  if (evt.type === 'private-data' && evt.raw[0] === 0x06 && evt.raw[1] === 0x0E) {
    const frame = parser.parse(evt.raw, BigInt(evt.pts * 90));
    if (frame) syncEngine.push(frame);
  }
});

function render() {
  const videoPts = BigInt(player.currentTime * 90000);
  const state = syncEngine.getInterpolatedStateAtPts(videoPts);
  if (state) updateProjection(state);
  requestAnimationFrame(render);
}
```

## 版本变更

### v1.0.0 (当前)
- **定位**: 首个商业基线 SDK 版本，支持范围以 `docs/supported-scenarios.md` 和 `docs/release-1.0-readiness.md` 为准。
- **新增**: 诊断/Debug Panel、鉴权/签名/恢复、播放偏好、后端录制 API、性能监控、IIFE 发布包和长稳运行工具。
- **增强**: WebRTC WHEP/WHIP 超时、HTTP 错误、SDP 错误、ICE gathering、ICE 断开/失败恢复诊断。
- **增强**: HLS/DASH 质量状态与手动/自动清晰度控制。
- **增强**: direct fMP4 HTTP/WS MSE 路径的有界队列、quota cleanup/retry 和本地 ffmpeg fixture 验证。
- **边界**: DRM、字幕、广告/埋点、前端录制、GB28181 服务端栈、PTZ 设备执行、PSV/Cesium 具体渲染器均保持插件化、后端化或外部包边界。

### v0.2.0
- **重构**: 拆分 `tech-hlsdash` 为独立的 `tech-hls` 和 `tech-dash`
- **新增**: `tech-fmp4` 支持无清单的 fMP4 直播流 (HTTP/WS + MSE)
- **新增**: 格式检测工具 `formatDetector`
- **优化**: 移除 `flv.js`，统一使用 `mpegts.js` 处理 FLV/TS
- **更新**: `TechName` 新增 `'hls' | 'dash' | 'fmp4'`
- **更新**: `preferTech` 从 `'hlsdash'` 改为 `'hls'` 或 `'dash'`

### v0.1.0
- 初始版本
- 支持 WebRTC、HLS/DASH、WS-Raw、GB28181、File 播放技术
- 插件架构
- 元数据提取 API
- 本地文件播放支持（MP4/TS/FLV）
## Metadata Parser Plugin

Core playback emits raw metadata events and does not parse KLV/MISB/SEI business semantics. Use the optional metadata plugin to connect a domain parser:

```typescript
import { createMetadataPlugin } from 'fyraplayer/plugins/metadata';

const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://server/stream',
    codec: 'h264',
    transport: 'ts',
    pipeline: 'experimental',
    metadata: { privateData: { enable: true } }
  }],
  plugins: [
    createMetadataPlugin({
      parse: (event) => externalKlvParser.parse(event.raw),
      onData: (parsed, raw) => {
        console.log('parsed metadata', parsed, raw.pts);
      },
      onDetected: (event) => {
        console.log('metadata detected', event);
      },
      onError: (error) => console.warn('metadata parse failed', error)
    })
  ]
});
```

This boundary is intentional: the stable `ws-raw` MSE path is a playback path, while metadata parsing is a plugin capability tied to streams and parsers that differ by deployment.
