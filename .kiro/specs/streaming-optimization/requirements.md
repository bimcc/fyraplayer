# Requirements Document

## Introduction

本文档定义 FyraPlayer 流媒体播放优化的需求，涵盖四个核心领域：
1. **WebRTC/OvenMediaEngine 信令修复** - 修复 ICE candidate 处理和流接收问题
2. **HLS/DASH 低延迟增强** - 优化低延迟直播配置
3. **Engine Adapter 架构** - 支持多流媒体服务器的 URL 转换和协议降级
4. **元数据提取架构** - 支持 KLV 私有数据流和 SEI NAL 单元的提取（解耦设计）

目标是提升播放稳定性、降低延迟、增强多协议兼容性，并支持专业视频应用场景。

**架构原则**：元数据提取采用回调/事件机制，Demuxer 只负责提取原始字节，具体解析（如 MISB 0601 KLV 解码）由外部库完成，保持播放器核心轻量。

## Glossary

- **FyraPlayer**: 本项目的 Web 播放器核心
- **Tech**: 播放技术抽象层，如 WebRTC Tech、HLS/DASH Tech、WS-Raw Tech
- **OvenMediaEngine (OME)**: 开源流媒体服务器，支持 WebRTC/LL-HLS/DASH
- **SRS**: Simple Realtime Server，开源流媒体服务器
- **ZLMediaKit (ZLM)**: 高性能流媒体服务器
- **MediaMTX**: 轻量级流媒体服务器
- **Signaling**: WebRTC 信令协商过程
- **ICE**: Interactive Connectivity Establishment，WebRTC 连接建立协议
- **Trickle_ICE**: 渐进式 ICE candidate 交换机制
- **LL-HLS**: Low-Latency HLS，苹果低延迟 HLS 协议
- **Engine_Adapter**: 流媒体服务器适配器，负责 URL 转换和降级链配置
- **Fallback_Chain**: 协议降级链，定义协议失败时的降级顺序
- **KLV**: Key-Length-Value，MISB 标准的元数据编码格式
- **MISB**: Motion Imagery Standards Board，运动图像标准委员会
- **PID**: Packet Identifier，MPEG-TS 中的数据包标识符
- **PMT**: Program Map Table，MPEG-TS 节目映射表
- **SEI**: Supplemental Enhancement Information，H.264/H.265 补充增强信息
- **NAL**: Network Abstraction Layer，网络抽象层单元
- **Private_Data_Stream**: MPEG-TS 中的私有数据流，stream_type 为 0x06 或 0x15

## Requirements

### Requirement 1: WebRTC/Oven 信令修复

**User Story:** As a developer, I want the WebRTC signaling to correctly handle OvenMediaEngine's protocol, so that WebRTC streams can be reliably established.

#### Acceptance Criteria

1. WHEN the OvenSignaling receives an offer from OME, THE System SHALL call `pc.setRemoteDescription()` with the offer SDP
2. WHEN the OvenSignaling receives remote ICE candidates, THE System SHALL call `pc.addIceCandidate()` for each candidate
3. WHEN the local ICE candidate is generated, THE System SHALL send it to OME via the signaling channel
4. WHEN the answer SDP is created, THE System SHALL send it to OME and wait for acknowledgment
5. IF the signaling WebSocket disconnects unexpectedly, THEN THE System SHALL emit a `network` event with `type: 'ws-close'` and `fatal: true`
6. IF the OME server returns an error message, THEN THE System SHALL parse the error and emit it via the event bus

### Requirement 2: WebRTC 流接收健壮性

**User Story:** As a user, I want WebRTC streams to play reliably even when the server sends tracks in non-standard ways, so that I can watch streams from various WebRTC servers.

#### Acceptance Criteria

1. WHEN `pc.ontrack` is triggered without `event.streams`, THE System SHALL create a new MediaStream from the track
2. WHEN multiple video tracks are received, THE System SHALL use only the first video track
3. WHEN an audio track is received after video, THE System SHALL add it to the existing MediaStream
4. WHEN `video.srcObject` is set, THE System SHALL attempt autoplay with muted=true
5. WHEN video metadata is not loaded within the configured timeout, THE System SHALL emit a warning and continue (not fail)

### Requirement 3: HLS 低延迟配置增强

**User Story:** As a developer, I want to configure HLS.js for optimal low-latency playback, so that live streams have minimal delay.

#### Acceptance Criteria

1. WHEN a HLS source has `lowLatency: true`, THE System SHALL configure hls.js with `lowLatencyMode: true`
2. WHEN low-latency mode is enabled, THE System SHALL set `liveSyncDurationCount` to 1 or 2
3. WHEN low-latency mode is enabled, THE System SHALL set `liveMaxLatencyDurationCount` to 3 or less
4. WHEN low-latency mode is enabled, THE System SHALL set `maxBufferLength` to 4 seconds or less
5. THE System SHALL expose buffer configuration via `BufferPolicy` for user customization

### Requirement 4: Engine Adapter 接口定义

**User Story:** As a developer, I want a standardized interface for stream server adapters, so that I can easily integrate different streaming servers without modifying the player core.

#### Acceptance Criteria

1. THE System SHALL define an `EngineAdapter` interface with methods for URL resolution and fallback chain configuration
2. THE EngineAdapter interface SHALL include a `resolveFromPublish(publishUrl, options)` method that converts publish URLs to playback URLs
3. THE EngineAdapter interface SHALL include a `resolveFromStream(streamName, serverConfig)` method for stream name based resolution
4. THE EngineAdapter interface SHALL include a `getFallbackChain()` method that returns the recommended protocol order
5. THE System SHALL define a `ResolvedSources` type containing `primary` Source and `fallbacks` Source array
6. THE System SHALL NOT include any specific server implementations in the core package

### Requirement 5: 协议层智能降级

**User Story:** As a user, I want the player to automatically try alternative protocols when one fails, so that I can watch streams even if WebRTC is blocked.

#### Acceptance Criteria

1. THE Source type definition SHALL support optional `fallbacks` array containing alternative Source configurations
2. WHEN a Tech fails to load or connect, THE System SHALL attempt the next source in the fallbacks array
3. WHEN all fallbacks are exhausted, THE System SHALL try the next Tech in techOrder with the primary source
4. THE System SHALL emit `network` events with `type: 'fallback'` and the new protocol name when switching
5. THE System SHALL track failed Techs to avoid repeated failures in the same session
6. THE System SHALL respect user-configured `techOrder` as the priority for Tech selection

### Requirement 6: Engine Adapter Middleware 支持

**User Story:** As a developer, I want to use middleware to automatically resolve stream URLs, so that I can simplify player configuration.

#### Acceptance Criteria

1. THE System SHALL support a `type: 'auto'` Source that requires resolution before playback
2. WHEN a Source has `type: 'auto'`, THE System SHALL invoke registered EngineAdapter middleware
3. THE middleware SHALL receive the source URL and engine hint, and return ResolvedSources
4. IF no adapter is registered for the specified engine, THEN THE System SHALL emit an error
5. THE System SHALL allow multiple adapters to be registered via middleware configuration

### Requirement 7: 连接状态监控增强

**User Story:** As a developer, I want detailed connection state events, so that I can implement custom reconnection logic or display connection status to users.

#### Acceptance Criteria

1. WHEN ICE connection state changes, THE System SHALL emit `network` event with `type: 'ice-state'` and the new state
2. WHEN WebRTC connection state changes to 'failed', THE System SHALL emit `network` event with `fatal: true`
3. WHEN a protocol fallback occurs, THE System SHALL emit `network` event with `type: 'fallback'`, the previous protocol, and the new protocol
4. THE System SHALL track and expose the current active protocol via `getCurrentTechName()`
5. WHEN reconnection is attempted, THE System SHALL emit `network` event with `type: 'reconnect'` and attempt count

### Requirement 8: 元数据提取配置

**User Story:** As a developer, I want to configure metadata extraction from MPEG-TS streams, so that I can access KLV telemetry data and SEI information synchronized with video.

#### Acceptance Criteria

1. THE WSRawSource type SHALL support an optional `metadata` configuration object
2. THE metadata configuration SHALL include `privateData.enable` boolean to activate private data stream extraction
3. THE metadata configuration SHALL include optional `privateData.pids` array for manual PID specification
4. THE metadata configuration SHALL include `sei.enable` boolean to activate SEI NAL unit extraction
5. WHEN privateData.enable is true and no pids are specified, THE System SHALL auto-detect private data PIDs from PMT
6. THE System SHALL only support metadata extraction for `transport: 'ts'` sources

### Requirement 9: 元数据事件发送

**User Story:** As a developer, I want to receive metadata through the event bus, so that I can process KLV, SEI, or other metadata with external parsing libraries.

#### Acceptance Criteria

1. THE System SHALL define a new `metadata` event type in EngineEvent
2. WHEN private data is extracted from a TS packet, THE System SHALL emit a `metadata` event with `type: 'private-data'`
3. WHEN SEI NAL unit is extracted, THE System SHALL emit a `metadata` event with `type: 'sei'`
4. THE metadata event payload SHALL include `raw` (Uint8Array), `pts` (presentation timestamp), and `type`
5. FOR private-data events, THE payload SHALL include `pid` (the source PID)
6. FOR sei events, THE payload SHALL include `seiType` (SEI payload type number)
7. THE System SHALL emit metadata events in presentation order synchronized with video frames

### Requirement 10: Demuxer 元数据提取能力

**User Story:** As a developer, I want the TS demuxer to extract metadata from both private data streams and SEI NAL units, so that I can process KLV, SEI, or other metadata with external libraries.

#### Acceptance Criteria

1. THE Demuxer SHALL support an optional `onPrivateData` callback for private data PID extraction
2. THE Demuxer SHALL support an optional `onSEI` callback for SEI NAL unit extraction
3. THE Demuxer SHALL parse PMT to identify private data stream types (stream_type 0x06 or 0x15)
4. WHEN parsing video NAL units, THE Demuxer SHALL detect SEI (NAL type 6 for H.264, NAL type 39/40 for H.265) and invoke the callback
5. THE Demuxer SHALL reassemble fragmented private data across multiple TS packets
6. THE callbacks SHALL receive raw bytes, PTS, and relevant metadata (pid for private data, seiType for SEI)
7. IF no callbacks are registered, THE Demuxer SHALL skip metadata processing (zero overhead)
8. THE System SHALL NOT include KLV parsing or SEI interpretation logic in the core Demuxer

### Requirement 11: KLV 解析模块集成

**User Story:** As a drone video developer, I want to use an external KLV parsing library with the player, so that I can access decoded MISB 0601 telemetry data.

#### Acceptance Criteria

1. THE System SHALL support integration with external KLV parsing libraries via the metadata event interface
2. THE System SHALL document the recommended integration pattern for @beeviz/klv or similar libraries
3. THE KLV parsing logic SHALL remain in external packages, not in the player core
4. THE System SHALL provide example code for connecting metadata events to KLV parsers
5. THE integration pattern SHALL support both real-time streaming and offline file parsing scenarios

