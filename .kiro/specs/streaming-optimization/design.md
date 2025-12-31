# Design Document: Streaming Optimization

## Overview

本设计文档描述 FyraPlayer 流媒体播放优化的技术实现方案，涵盖四个核心领域：

1. **WebRTC/OvenMediaEngine 信令修复** - 完善 ICE candidate 处理和流接收健壮性
2. **HLS/DASH 低延迟增强** - 优化 hls.js 低延迟配置
3. **Engine Adapter 架构** - 支持多流媒体服务器的 URL 转换和协议降级
4. **元数据提取架构** - 支持 KLV 私有数据流和 SEI NAL 单元的解耦提取

## Architecture

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           FyraPlayer Core                                │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │  WebRTC     │  │  HLS/DASH   │  │  WS-Raw     │  │  File       │    │
│  │  Tech       │  │  Tech       │  │  Tech       │  │  Tech       │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │                │            │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐                     │
│  │ Oven/WHEP   │  │  hls.js     │  │  Demuxer    │                     │
│  │ Signaling   │  │  dash.js    │  │  (TS/FLV)   │                     │
│  └─────────────┘  └─────────────┘  └──────┬──────┘                     │
│                                           │                             │
│                                    ┌──────┴──────┐                     │
│                                    │ Metadata    │                     │
│                                    │ Callbacks   │                     │
│                                    │ (optional)  │                     │
│                                    └─────────────┘                     │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│  │ EventBus    │  │ Middleware  │  │ TechManager │                     │
│  │ (metadata)  │  │ (adapter)   │  │ (fallback)  │                     │
│  └─────────────┘  └─────────────┘  └─────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    External Libraries (Optional)                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
│  │ @beeviz/klv     │  │ SEI Parser      │  │ Engine Adapters │         │
│  │ (MISB 0601)     │  │ (User-defined)  │  │ (OME/SRS/ZLM)   │         │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 元数据提取数据流

```
TS Stream
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Demuxer                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ PAT/PMT    │  │ Video PES   │  │ Private PES │             │
│  │ Parser     │  │ (H.264/265) │  │ (0x06/0x15) │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         │         ┌──────┴──────┐  ┌──────┴──────┐             │
│         │         │ NAL Parser  │  │ PES Reassem │             │
│         │         │ (SEI detect)│  │ (fragment)  │             │
│         │         └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         │         ┌──────┴──────┐  ┌──────┴──────┐             │
│         │         │ onSEI()     │  │onPrivateData│             │
│         │         │ callback    │  │ callback    │             │
│         │         └──────┬──────┘  └──────┬──────┘             │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          │                ▼                ▼
          │         ┌─────────────────────────────┐
          │         │      EventBus               │
          │         │  emit('metadata', {...})    │
          │         └──────────────┬──────────────┘
          │                        │
          │                        ▼
          │         ┌─────────────────────────────┐
          │         │   External KLV/SEI Parser   │
          │         │   (user-registered handler) │
          │         └─────────────────────────────┘
          │
          ▼
   ┌─────────────┐
   │ Video Frame │
   │ (decode)    │
   └─────────────┘
```

## Components and Interfaces

### 1. WebRTC Signaling 增强

#### OvenSignaling 修复

```typescript
// src/techs/webrtc/ovenSignaling.ts

export class OvenSignaling {
  private pc: RTCPeerConnection | null = null;
  
  // 新增：支持 Trickle ICE
  async setup(pc: RTCPeerConnection, config: OvenSignalConfig, onEvent: EventCallback): Promise<void> {
    this.pc = pc;
    
    // 监听本地 ICE candidate
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendCandidate(event.candidate.candidate);
        onEvent({ type: 'local-candidate', candidate: event.candidate });
      }
    };
    
    // 连接 WebSocket
    await this.connect();
    
    // 注册远程 offer 处理
    this.onRemoteOffer(async (sdp) => {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendAnswer(answer.sdp!);
    });
    
    // 注册远程 ICE candidate 处理
    this.onRemoteCandidate(async (candidate) => {
      await pc.addIceCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 });
      onEvent({ type: 'remote-candidate-added' });
    });
  }
}
```

#### WebRTC Track 健壮性处理

```typescript
// src/techs/tech-webrtc.ts

private bindTracks(): void {
  if (!this.pc) return;
  
  let mediaStream: MediaStream | null = null;
  
  this.pc.ontrack = (evt) => {
    // 健壮性：处理无 streams 的情况
    if (evt.streams && evt.streams[0]) {
      mediaStream = evt.streams[0];
    } else {
      // 创建新的 MediaStream
      if (!mediaStream) {
        mediaStream = new MediaStream();
      }
      mediaStream.addTrack(evt.track);
    }
    
    // 只使用第一个视频轨道
    const videoTracks = mediaStream.getVideoTracks();
    if (videoTracks.length > 1) {
      for (let i = 1; i < videoTracks.length; i++) {
        mediaStream.removeTrack(videoTracks[i]);
      }
    }
    
    if (this.video) {
      this.video.srcObject = mediaStream;
      // 尝试自动播放（静音）
      this.video.muted = true;
      this.video.play().catch(() => {
        this.bus.emit('network', { type: 'autoplay-blocked' });
      });
    }
  };
}
```

### 2. HLS 低延迟配置

```typescript
// src/techs/tech-hlsdash.ts

interface LowLatencyConfig {
  lowLatencyMode: boolean;
  liveSyncDurationCount: number;
  liveMaxLatencyDurationCount: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
  backBufferLength: number;
}

function buildLowLatencyConfig(source: HLSSource, buffer?: BufferPolicy): Partial<HlsConfig> {
  if (!source.lowLatency) return {};
  
  return {
    lowLatencyMode: true,
    liveSyncDurationCount: buffer?.targetLatencyMs ? Math.ceil(buffer.targetLatencyMs / 1000) : 2,
    liveMaxLatencyDurationCount: 3,
    maxBufferLength: buffer?.maxBufferMs ? buffer.maxBufferMs / 1000 : 4,
    maxMaxBufferLength: 8,
    backBufferLength: 0,
  };
}
```

### 3. Engine Adapter 接口

```typescript
// src/types.ts (新增类型定义)

export interface EngineAdapter {
  /** 适配器名称，如 'ome', 'srs', 'zlm' */
  name: string;
  
  /** 从推流 URL 解析播放 URL */
  resolveFromPublish(publishUrl: string, options?: ResolveOptions): ResolvedSources;
  
  /** 从流名称解析播放 URL */
  resolveFromStream(streamName: string, serverConfig: ServerConfig): ResolvedSources;
  
  /** 获取推荐的协议降级链 */
  getFallbackChain(): TechName[];
}

export interface ResolvedSources {
  primary: Source;
  fallbacks: Source[];
}

export interface ResolveOptions {
  preferProtocol?: 'webrtc' | 'hls' | 'dash' | 'ws-raw';
  lowLatency?: boolean;
}

export interface ServerConfig {
  host: string;
  port?: number;
  app?: string;
  secure?: boolean;
}

// Source 类型扩展
export type AutoSource = {
  type: 'auto';
  url: string;
  engine?: string;  // 'ome' | 'srs' | 'zlm' | 'mediamtx'
  fallbacks?: Source[];
};

export type Source = WebRTCSource | HLSSource | DASHSource | WSRawSource | FileSource | AutoSource;
```

### 4. 协议降级机制

```typescript
// src/core/techManager.ts (扩展)

export class TechManager {
  private failedTechs = new Set<TechName>();
  
  async selectAndLoad(
    sources: Source[],
    techOrder: TechName[],
    opts: LoadOptions
  ): Promise<LoadResult | null> {
    // 过滤已失败的 Tech
    const effectiveOrder = techOrder.filter(t => !this.failedTechs.has(t));
    
    for (const source of sources) {
      // 尝试主源
      const result = await this.tryLoadSource(source, effectiveOrder, opts);
      if (result) return result;
      
      // 尝试 fallbacks
      if ('fallbacks' in source && source.fallbacks) {
        for (const fallback of source.fallbacks) {
          const fbResult = await this.tryLoadSource(fallback, effectiveOrder, opts);
          if (fbResult) {
            this.bus.emit('network', { 
              type: 'fallback', 
              from: source.type, 
              to: fallback.type 
            });
            return fbResult;
          }
        }
      }
    }
    
    return null;
  }
  
  markTechFailed(tech: TechName): void {
    this.failedTechs.add(tech);
  }
  
  resetFailedTechs(): void {
    this.failedTechs.clear();
  }
}
```

### 5. 元数据提取接口

#### Demuxer 回调接口

```typescript
// src/techs/wsRaw/demuxer.ts (扩展)

export interface DemuxerCallbacks {
  /** 私有数据流回调 (KLV 等) */
  onPrivateData?: (pid: number, data: Uint8Array, pts: number) => void;
  
  /** SEI NAL 单元回调 */
  onSEI?: (data: Uint8Array, pts: number, seiType: number) => void;
}

export interface DemuxerOptions {
  format: 'flv' | 'ts' | 'annexb';
  callbacks?: DemuxerCallbacks;
  privateDataPids?: number[];  // 手动指定 PID，否则自动检测
}
```

#### 元数据配置类型

```typescript
// src/types.ts (扩展 WSRawSource)

export interface MetadataConfig {
  privateData?: {
    enable: boolean;
    pids?: number[];  // 手动指定 PID
  };
  sei?: {
    enable: boolean;
  };
}

export type WSRawSource = {
  type: 'ws-raw';
  url: string;
  codec: 'h264' | 'h265';
  transport?: 'flv' | 'ts' | 'annexb';
  heartbeatMs?: number;
  preferTech?: 'ws-raw';
  experimental?: boolean;
  decoderUrl?: string;
  disableAudio?: boolean;
  audioOptional?: boolean;
  metadata?: MetadataConfig;  // 新增
};
```

#### 元数据事件类型

```typescript
// src/types.ts (扩展 EngineEvent)

export type EngineEvent =
  | 'ready' | 'play' | 'pause' | 'ended' | 'error'
  | 'buffer' | 'tracks' | 'levelSwitch'
  | 'stats' | 'qos' | 'sei' | 'network' | 'data'
  | 'metadata';  // 新增

export interface MetadataEvent {
  type: 'private-data' | 'sei';
  raw: Uint8Array;
  pts: number;
  pid?: number;      // for private-data
  seiType?: number;  // for sei
}
```

## Data Models

### Demuxer 内部状态

```typescript
interface TsState {
  pmtPid: number;
  videoPid: number;
  audioPid: number;
  privateDataPids: Set<number>;  // 新增：私有数据 PID 集合
  patParsed: boolean;
  pmtParsed: boolean;
  videoPes: PesBuffer | null;
  audioPes: PesBuffer | null;
  privateDataPes: Map<number, PesBuffer>;  // 新增：私有数据 PES 缓冲
}

interface PesBuffer {
  pts: number;
  data: Uint8Array[];
}
```

### SEI 类型定义

```typescript
// H.264 SEI payload types
enum H264SeiType {
  BUFFERING_PERIOD = 0,
  PIC_TIMING = 1,
  PAN_SCAN_RECT = 2,
  FILLER_PAYLOAD = 3,
  USER_DATA_REGISTERED = 4,
  USER_DATA_UNREGISTERED = 5,
  RECOVERY_POINT = 6,
  // ... more types
}

// H.265 SEI payload types (prefix/suffix)
enum H265SeiType {
  BUFFERING_PERIOD = 0,
  PICTURE_TIMING = 1,
  PAN_SCAN_RECT = 2,
  // ... more types
}
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: WebRTC Signaling Message Handling

*For any* WebRTC signaling session with OvenMediaEngine:
- When an offer SDP is received, `pc.setRemoteDescription()` must be called with that SDP
- When remote ICE candidates are received, `pc.addIceCandidate()` must be called for each
- When local ICE candidates are generated, they must be sent via the signaling channel

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Multiple Video Tracks Handling

*For any* sequence of video tracks received via WebRTC `ontrack`, the system shall use only the first video track and discard subsequent ones.

**Validates: Requirements 2.2**

### Property 3: HLS Low-Latency Configuration Constraints

*For any* HLS source with `lowLatency: true`:
- `liveSyncDurationCount` must be 1 or 2
- `liveMaxLatencyDurationCount` must be ≤ 3
- `maxBufferLength` must be ≤ 4 seconds

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

### Property 4: Protocol Fallback Chain Behavior

*For any* source with fallbacks defined:
- When a Tech fails, the next source in fallbacks must be attempted
- When all fallbacks are exhausted, the next Tech in techOrder must be tried
- A `network` event with `type: 'fallback'` must be emitted on each switch
- Failed Techs must be tracked and skipped in subsequent attempts
- User-configured `techOrder` must be respected as priority

**Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**

### Property 5: ICE State Event Emission

*For any* ICE connection state change in WebRTC, the system shall emit a `network` event with `type: 'ice-state'` and the new state value.

**Validates: Requirements 7.1**

### Property 6: Reconnection Event Tracking

*For any* reconnection attempt, the system shall emit a `network` event with `type: 'reconnect'` and the current attempt count.

**Validates: Requirements 7.5**

### Property 7: Current Tech Name Tracking

*For any* active playback session, `getCurrentTechName()` shall return the name of the currently active Tech.

**Validates: Requirements 7.4**

### Property 8: Private Data PID Auto-Detection

*For any* MPEG-TS stream with private data streams (stream_type 0x06 or 0x15) in PMT, when `privateData.enable` is true and no PIDs are specified, the system shall auto-detect and extract from those PIDs.

**Validates: Requirements 8.5, 10.3**

### Property 9: Metadata Extraction Transport Constraint

*For any* WSRawSource, metadata extraction (privateData or SEI) shall only be performed when `transport: 'ts'` is specified.

**Validates: Requirements 8.6**

### Property 10: Metadata Event Structure

*For any* metadata event emitted:
- The payload must include `raw` (Uint8Array), `pts` (number), and `type` ('private-data' | 'sei')
- For `type: 'private-data'`, the payload must include `pid`
- For `type: 'sei'`, the payload must include `seiType`

**Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6**

### Property 11: Metadata Event Ordering

*For any* sequence of metadata events, they shall be emitted in presentation order (sorted by PTS).

**Validates: Requirements 9.7**

### Property 12: SEI NAL Detection

*For any* H.264 video stream containing SEI NAL units (NAL type 6), when `sei.enable` is true, the `onSEI` callback shall be invoked for each SEI NAL with the raw bytes, PTS, and SEI payload type.

**Validates: Requirements 10.4**

### Property 13: Private Data Reassembly

*For any* private data that spans multiple TS packets, the Demuxer shall reassemble the fragments into complete data before invoking the callback.

**Validates: Requirements 10.5**

### Property 14: Auto Source Middleware Invocation

*For any* source with `type: 'auto'`, the system shall invoke registered EngineAdapter middleware to resolve the source before playback.

**Validates: Requirements 6.2**

## Error Handling

### WebRTC Errors

| Error Condition | Handling |
|-----------------|----------|
| WebSocket disconnect | Emit `network` event with `type: 'ws-close'`, `fatal: true` |
| OME server error | Parse error message, emit via event bus |
| ICE connection failed | Emit `network` event with `type: 'ice-failed'`, attempt ICE restart |
| Connect timeout | Emit `network` event with `type: 'connect-timeout'` |
| Autoplay blocked | Emit `network` event with `type: 'autoplay-blocked'` |

### Fallback Errors

| Error Condition | Handling |
|-----------------|----------|
| Tech load failure | Mark tech as failed, try next fallback |
| All fallbacks exhausted | Try next tech in techOrder |
| No compatible tech | Throw error with detailed causes |
| Missing adapter | Emit error for unregistered engine |

### Metadata Extraction Errors

| Error Condition | Handling |
|-----------------|----------|
| No private data PID in PMT | Log warning, continue without extraction |
| Malformed PES packet | Skip packet, continue processing |
| Callback throws | Catch error, log, continue processing |

## Testing Strategy

### Unit Tests

Unit tests focus on specific examples and edge cases:

1. **WebRTC Signaling**
   - Test offer/answer exchange sequence
   - Test ICE candidate handling
   - Test WebSocket error scenarios

2. **HLS Configuration**
   - Test low-latency config generation
   - Test buffer policy application

3. **Fallback Logic**
   - Test single fallback scenario
   - Test multiple fallback chain
   - Test tech order priority

4. **Metadata Extraction**
   - Test PMT parsing for private data PIDs
   - Test SEI NAL detection in H.264 stream
   - Test PES reassembly

### Property-Based Tests

Property-based tests verify universal properties across many generated inputs:

1. **WebRTC Signaling Properties** (Property 1)
   - Generate random offer/candidate sequences
   - Verify all are processed correctly

2. **HLS Config Constraints** (Property 3)
   - Generate random buffer policies
   - Verify output config meets constraints

3. **Fallback Chain Properties** (Property 4)
   - Generate random source/tech combinations
   - Verify fallback behavior is correct

4. **Metadata Event Properties** (Properties 10, 11)
   - Generate random TS streams with metadata
   - Verify event structure and ordering

### Testing Framework

- **Unit Tests**: Jest with TypeScript
- **Property-Based Tests**: fast-check
- **Minimum iterations**: 100 per property test
- **Tag format**: `Feature: streaming-optimization, Property N: {property_text}`

### Integration Test Scenarios

1. **End-to-end WebRTC with OME**
   - Connect to real OME server
   - Verify stream playback

2. **HLS Low-Latency Playback**
   - Play LL-HLS stream
   - Measure actual latency

3. **Metadata Extraction with KLV**
   - Play TS stream with KLV data
   - Verify @beeviz/klv integration

