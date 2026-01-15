# FyraPlayer API

通用低延迟 Web 播放器，支持 WebRTC、HLS/DASH、WebSocket+WebCodecs、本地文件等多种播放技术。

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

### EventBus

```typescript
class EventBus {
  on(event: string, listener: (...args: any[]) => void): void
  once(event: string, listener: (...args: any[]) => void): void
  off(event: string, listener: (...args: any[]) => void): void
  removeAllListeners(event?: string): void
  emit(event: string, ...args: any[]): void
  listenerCount(event: string): number
}
```

## 类型定义

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

### Source 类型

```typescript
type TechName = 'webrtc' | 'hlsdash' | 'ws-raw' | 'file' | 'gb28181'

type Source = 
  | WebRTCSource 
  | HLSSource 
  | DASHSource 
  | WSRawSource 
  | Gb28181Source 
  | FileSource 
  | AutoSource

interface WebRTCSource {
  type: 'webrtc'
  url: string
  iceServers?: RTCIceServer[]
  forceRelay?: boolean
  signal?: WebRTCSignalConfig
}

interface HLSSource {
  type: 'hls'
  url: string
  lowLatency?: boolean
  drm?: DRMConfig
}

interface DASHSource {
  type: 'dash'
  url: string
  drm?: DRMConfig
}

interface WSRawSource {
  type: 'ws-raw'
  url: string
  codec: 'h264' | 'h265'
  transport?: 'flv' | 'ts' | 'annexb' | 'ps'
  metadata?: MetadataConfig
  webTransport?: boolean
}

interface FileSource {
  type: 'file'
  url: string
  /** Container format hint for blob URLs (since extension is not available) */
  container?: 'ts' | 'mp4' | 'mkv' | 'webm' | 'flv'
  metadata?: MetadataConfig
}

interface Gb28181Source {
  type: 'gb28181'
  url: string
  control: { invite: string; bye: string; ptz?: string }
  gb: { deviceId: string; channelId: string }
  format?: 'annexb' | 'ts' | 'ps'
  codecHints?: { video?: 'h264' | 'h265'; audio?: 'aac' | 'pcma' | 'pcmu' | 'opus' }
  webTransport?: boolean
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

### PlayerState

```typescript
type PlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'
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
| `sei` | `{ raw: Uint8Array, pts: number }` | SEI 数据 |
| `data` | `any` | DataChannel 数据 |
| `qos` | `QoSEvent` | 质量指标事件 |

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

## 播放技术 (Tech)

### tech-webrtc

WebRTC 低延迟播放，支持多种信令协议：

| 信令类型 | URL 格式 | 说明 |
|----------|----------|------|
| WHEP | `http(s)://...` | 标准 WHEP 协议 |
| WHIP | `http(s)://...` | 标准 WHIP 协议 |
| Oven-WS | `ws(s)://...` | OvenMediaEngine WebSocket 信令 |

### tech-hlsdash

HLS/DASH 自适应码率播放：

- HLS: 基于 hls.js，支持 LL-HLS
- DASH: 基于 dash.js

### tech-ws-raw

WebSocket + WebCodecs 低延迟播放：

- 支持 FLV、TS、AnnexB、PS 容器格式
- 自研解复用器，支持 H.264/H.265
- 支持元数据提取（KLV/SEI）
- 可选 WebTransport 传输

### tech-file

本地/远程文件播放：

| 格式 | 播放方式 | 说明 |
|------|----------|------|
| MP4 | 原生 video.src | 浏览器原生支持 |
| TS | mpegts.js | MSE 播放 |
| FLV | mpegts.js | MSE 播放 |
| blob: URL | 根据 container hint | 本地文件需指定 container 类型 |

```typescript
// 本地 TS 文件播放示例
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'file',
    url: blobUrl,
    container: 'ts'  // 必须指定，因为 blob URL 没有扩展名
  }]
});
```

### tech-gb28181

国标 GB28181 流播放：

- 支持 Invite/Bye 控制
- 支持 PTZ 云台控制
- 支持 AnnexB/TS/PS 格式
- 可选 WebTransport 传输

## 使用示例

### 基础播放

```typescript
import { FyraPlayer } from 'fyraplayer';

const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'webrtc',
    url: 'wss://server/stream'
  }],
  autoplay: true,
  muted: true
});

player.on('ready', () => console.log('Player ready'));
player.on('error', (err) => console.error('Error:', err));

await player.init();
```

### 本地文件播放

```typescript
// HTML: <input type="file" id="file-input" accept="video/*,.ts,.mp4">

const fileInput = document.getElementById('file-input');
fileInput.onchange = async () => {
  const file = fileInput.files[0];
  const blobUrl = URL.createObjectURL(file);
  const ext = file.name.split('.').pop().toLowerCase();
  
  // 根据扩展名确定 container 类型
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
    // KLV 数据，传递给 @aspect/openklv 解析
    console.log('KLV data:', evt.raw, 'PID:', evt.pid);
  }
});
```

### 使用插件

```typescript
import { FyraPlayer } from 'fyraplayer';
import { FyraPsvAdapter } from 'fyraplayer/plugins/psv';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'webrtc', url: '...' }],
  plugins: [FyraPsvAdapter]
});
```

## 与 @aspect/openklv 集成

### 架构说明

FyraPlayer 的 TS 解复用器可以提取私有数据流（stream_type 0x06/0x15），这些数据可能包含 KLV 元数据。openklv 负责 KLV 的语义解析。

```
FyraPlayer ts-demuxer → onPrivateData(pid, bytes, pts) → openklv KLVParser
                                                              ↓
                                                        SyncEngine → DroneState
```

### 为什么不在 FyraPlayer 中直接解析 KLV？

1. **职责分离**: FyraPlayer 是通用播放器，不应绑定特定元数据格式
2. **灵活性**: 私有数据不一定是 KLV，可能是其他格式
3. **可选依赖**: 不需要 KLV 的应用无需引入 openklv

### 完整集成示例

```typescript
import { FyraPlayer } from 'fyraplayer';
import { KLVParser, SyncEngine, MISB0601Frame } from '@aspect/openklv';

// 初始化 openklv
const parser = new KLVParser();
const syncEngine = new SyncEngine({
  outlierFilterEnabled: true
});

// 初始化播放器
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://server/stream',
    codec: 'h264',
    transport: 'ts',
    metadata: {
      privateData: { enable: true }
    }
  }]
});

// KLV Universal Label 前缀
const UAS_KEY = [0x06, 0x0E, 0x2B, 0x34];

function isKLV(data: Uint8Array): boolean {
  return data.length >= 4 &&
    data[0] === UAS_KEY[0] &&
    data[1] === UAS_KEY[1] &&
    data[2] === UAS_KEY[2] &&
    data[3] === UAS_KEY[3];
}

// 处理元数据事件
player.on('metadata', (evt) => {
  if (evt.type === 'private-data' && isKLV(evt.raw)) {
    // PTS 从毫秒转换为 90kHz 时钟
    const pts = BigInt(evt.pts * 90);
    const frame = parser.parse(evt.raw, pts);
    if (frame) {
      syncEngine.push(frame);
    }
  }
});

// 渲染循环中获取同步状态
function render() {
  const videoPts = BigInt(player.currentTime * 90000);
  const state = syncEngine.getInterpolatedStateAtPts(videoPts);
  
  if (state) {
    // 使用 DroneState 更新 Cesium 投影
    console.log('Position:', state.platform.lat, state.platform.lon);
    console.log('Attitude:', state.platform.heading, state.platform.pitch);
  }
  
  requestAnimationFrame(render);
}

await player.init();
render();
```

### 静态 TS 文件处理

对于静态 TS 文件，FyraPlayer 的 `tech-file` 目前不触发 metadata 事件。有两种解决方案：

**方案 A: 使用 openklv 独立处理**

```typescript
import { KLVStreamManager } from '@aspect/openklv';

const manager = new KLVStreamManager();
const buffer = await fetch('/video.ts').then(r => r.arrayBuffer());
await manager.loadFromBuffer(new Uint8Array(buffer));

// 获取指定时间的状态
const state = manager.getStateAtTime(targetTime);
```

**方案 B: 应用层预处理**

```typescript
// 在 beeviz 等应用层，加载 TS 文件时同时处理
async function loadTsFile(url: string) {
  const buffer = await fetch(url).then(r => r.arrayBuffer());
  
  // 1. 用 openklv 提取 KLV
  await klvModule.loadFromBuffer(new Uint8Array(buffer));
  
  // 2. 用 FyraPlayer 播放视频
  await player.loadUrl(url);
}
```

## 版本变更

### v0.1.0
- 初始版本
- 支持 WebRTC、HLS/DASH、WS-Raw、GB28181、File 播放技术
- 插件架构
- 元数据提取 API
- 本地文件播放支持（MP4/TS/FLV）
- FileSource 添加 `container` 字段支持 blob URL 格式识别
