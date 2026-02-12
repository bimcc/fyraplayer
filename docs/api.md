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
  getCurrentSource(): Source | undefined
  get currentTime(): number  // 当前播放时间（秒）
  
  // 事件
  on(event: string, handler: (...args: any[]) => void): void
  once(event: string, handler: (...args: any[]) => void): void
  off(event: string, handler: (...args: any[]) => void): void
  
  // 源切换
  switchSource(index: number): Promise<void>
  
  // 控制（Tech 特定操作）
  control(action: string, payload?: any): Promise<any>
  
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
  ui?: UIOptions
  plugins?: PluginCtor[]
  middleware?: MiddlewareEntry[]
  metrics?: MetricsOptions
  buffer?: BufferPolicy
  reconnect?: ReconnectPolicy
  webCodecs?: WebCodecsConfig
  dataChannel?: DataChannelOptions
}
```

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
  codec?: 'h264' | 'h265' | 'av1'
  audioCodec?: 'aac' | 'opus' | 'mp3'
  isLive?: boolean
  preferTech?: 'fmp4'
}

// WebSocket 原始流
interface WSRawSource {
  type: 'ws-raw'
  url: string
  codec: 'h264' | 'h265'
  transport?: 'flv' | 'ts' | 'annexb' | 'ps'
  decoderUrl?: string
  wasm?: WasmDecoderConfig
  heartbeatMs?: number
  metadata?: MetadataConfig
  audioOptional?: boolean
  disableAudio?: boolean
  webTransport?: boolean
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

// GB28181 国标流
interface Gb28181Source {
  type: 'gb28181'
  url: string
  control: { invite: string; bye: string; ptz?: string }
  gb: { deviceId: string; channelId: string }
  responseMapping?: {
    url?: string
    callId?: string
    ssrc?: string
    streamInfo?: string
    streamId?: string
  }
  format?: 'annexb' | 'ts' | 'ps'
  codecHints?: { video?: 'h264' | 'h265'; audio?: 'aac' | 'pcma' | 'pcmu' | 'opus' }
  webTransport?: boolean
  preferTech?: 'gb28181'
}
```

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
}
```

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

### tech-hls

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
```

### tech-ws-raw

WebSocket + WebCodecs 低延迟播放：

- 支持 FLV、TS、AnnexB、PS 容器格式
- 自研解复用器，支持 H.264/H.265
- 支持元数据提取（KLV/SEI）
- HTTP-FLV 通过 mpegts.js 回退

- WebCodecs auto-builds codec string from SPS/VPS; if config fails and decoderUrl exists it falls back to WASM decode


```typescript
{ type: 'ws-raw', url: 'wss://...', codec: 'h264', transport: 'flv', preferTech: 'ws-raw' }
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

国标 GB28181 流播放：

- 支持 Invite/Bye 控制
- 支持 PTZ 云台控制
- 支持 AnnexB/TS/PS 格式
- 可选 WebTransport 传输

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
| `network` | `NetworkEvent` | 网络状态变化 |
| `metadata` | `MetadataEvent` | 元数据（KLV/SEI） |
| `levelSwitch` | `{ level: number }` | 码率切换 |

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
}
```

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

### v0.2.0 (当前)
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
