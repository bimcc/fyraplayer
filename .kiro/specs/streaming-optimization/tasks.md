# Implementation Plan: Streaming Optimization

## Overview

本实现计划将流媒体优化功能分为四个主要模块，按依赖关系顺序实现：
1. 类型定义和接口扩展
2. WebRTC 信令修复
3. HLS 低延迟配置
4. 协议降级机制
5. 元数据提取架构

## Tasks

- [x] 1. 类型定义和接口扩展
  - [x] 1.1 扩展 Source 类型定义
    - 添加 `AutoSource` 类型
    - 扩展 `WSRawSource` 添加 `metadata` 配置
    - 添加 `fallbacks` 可选字段到所有 Source 类型
    - _Requirements: 4.5, 5.1, 8.1, 8.2, 8.3, 8.4_
  - [x] 1.2 添加 EngineAdapter 接口定义
    - 定义 `EngineAdapter` 接口
    - 定义 `ResolvedSources` 类型
    - 定义 `ResolveOptions` 和 `ServerConfig` 类型
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [x] 1.3 扩展 EngineEvent 类型
    - 添加 `metadata` 事件类型
    - 定义 `MetadataEvent` 接口
    - _Requirements: 9.1_
  - [x] 1.4 添加 DemuxerCallbacks 接口
    - 定义 `onPrivateData` 回调签名
    - 定义 `onSEI` 回调签名
    - 定义 `DemuxerOptions` 接口
    - _Requirements: 10.1, 10.2_

- [x] 2. WebRTC 信令修复
  - [x] 2.1 修复 OvenSignaling ICE candidate 处理
    - 实现 `pc.addIceCandidate()` 调用
    - 实现本地 ICE candidate 发送
    - 添加 Trickle ICE 支持
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 2.2 编写 OvenSignaling 单元测试
    - 测试 offer/answer 交换
    - 测试 ICE candidate 处理
    - 测试 WebSocket 错误场景
    - _Requirements: 1.5, 1.6_
  - [x] 2.3 增强 WebRTC Track 健壮性
    - 处理无 `event.streams` 的情况
    - 实现多视频轨道过滤（只保留第一个）
    - 实现音频轨道后添加逻辑
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 2.4 实现自动播放和超时处理
    - 实现 muted 自动播放
    - 实现元数据加载超时警告
    - _Requirements: 2.4, 2.5_
  - [x] 2.5 编写 WebRTC Track 处理属性测试
    - **Property 2: Multiple Video Tracks Handling**
    - **Validates: Requirements 2.2**

- [x] 3. Checkpoint - WebRTC 模块完成
  - 确保所有 WebRTC 相关测试通过
  - 如有问题请询问用户

- [x] 4. HLS 低延迟配置
  - [x] 4.1 实现 HLS 低延迟配置生成
    - 实现 `buildLowLatencyConfig` 函数
    - 集成到 HLSDASHTech
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 4.2 编写 HLS 配置属性测试
    - **Property 3: HLS Low-Latency Configuration Constraints**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
  - [x] 4.3 实现 BufferPolicy 配置暴露
    - 确保用户可自定义缓冲配置
    - _Requirements: 3.5_

- [x] 5. 协议降级机制
  - [x] 5.1 扩展 TechManager 支持 fallbacks
    - 实现 fallback 源尝试逻辑
    - 实现失败 Tech 跟踪
    - 实现 techOrder 优先级
    - _Requirements: 5.2, 5.3, 5.5, 5.6_
  - [x] 5.2 实现降级事件发送
    - 发送 `network` 事件 `type: 'fallback'`
    - 包含 from/to 协议信息
    - _Requirements: 5.4, 7.3_
  - [x] 5.3 编写协议降级属性测试
    - **Property 4: Protocol Fallback Chain Behavior**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6**
  - [x] 5.4 实现 Auto Source 中间件支持
    - 实现 `type: 'auto'` 源识别
    - 实现 EngineAdapter 中间件调用
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 6. 连接状态监控增强
  - [x] 6.1 实现 ICE 状态事件发送
    - 发送 `network` 事件 `type: 'ice-state'`
    - _Requirements: 7.1_
  - [x] 6.2 实现重连事件发送
    - 发送 `network` 事件 `type: 'reconnect'`
    - 包含 attempt count
    - _Requirements: 7.5_
  - [x] 6.3 编写连接状态属性测试
    - **Property 5: ICE State Event Emission**
    - **Property 6: Reconnection Event Tracking**
    - **Validates: Requirements 7.1, 7.5**

- [x] 7. Checkpoint - 协议层完成
  - 确保所有协议相关测试通过
  - 如有问题请询问用户

- [x] 8. Demuxer 元数据提取能力
  - [x] 8.1 扩展 Demuxer 支持回调配置
    - 添加 `DemuxerCallbacks` 参数
    - 添加 `privateDataPids` 配置
    - _Requirements: 10.1, 10.2_
  - [x] 8.2 实现 PMT 私有数据 PID 检测
    - 解析 stream_type 0x06 和 0x15
    - 自动添加到 privateDataPids
    - _Requirements: 10.3, 8.5_
  - [x] 8.3 实现私有数据 PES 提取
    - 添加私有数据 PES 缓冲
    - 实现跨包重组
    - 调用 `onPrivateData` 回调
    - _Requirements: 10.5, 10.6_
  - [x] 8.4 编写私有数据提取属性测试
    - **Property 8: Private Data PID Auto-Detection**
    - **Property 13: Private Data Reassembly**
    - **Validates: Requirements 8.5, 10.3, 10.5**
  - [x] 8.5 实现 SEI NAL 检测和提取
    - 在视频 NAL 解析中检测 NAL type 6 (H.264)
    - 解析 SEI payload type
    - 调用 `onSEI` 回调
    - _Requirements: 10.4_
  - [x] 8.6 编写 SEI 提取属性测试
    - **Property 12: SEI NAL Detection**
    - **Validates: Requirements 10.4**

- [x] 9. 元数据事件集成
  - [x] 9.1 实现 WS-Raw Tech 元数据配置处理
    - 解析 `metadata` 配置
    - 仅对 `transport: 'ts'` 启用
    - _Requirements: 8.5, 8.6_
  - [x] 9.2 实现元数据事件发送
    - 通过 EventBus 发送 `metadata` 事件
    - 包含 raw, pts, type, pid/seiType
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6_
  - [x] 9.3 实现元数据事件排序
    - 按 PTS 顺序发送事件
    - _Requirements: 9.7_
  - [x] 9.4 编写元数据事件属性测试
    - **Property 10: Metadata Event Structure**
    - **Property 11: Metadata Event Ordering**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5, 9.6, 9.7**

- [x] 10. Checkpoint - 元数据模块完成
  - 确保所有元数据相关测试通过
  - 如有问题请询问用户

- [x] 11. KLV 集成文档和示例
  - [x] 11.1 编写 KLV 集成文档
    - 文档化 @beeviz/klv 集成模式
    - 提供实时流和离线文件示例
    - _Requirements: 11.1, 11.2, 11.4, 11.5_
  - [x] 11.2 创建 KLV 集成示例代码
    - 创建 examples/klv-integration.ts
    - 展示 metadata 事件到 KLV 解析器的连接
    - _Requirements: 11.4_

- [x] 12. 最终检查点
  - 确保所有测试通过
  - 运行完整测试套件
  - 如有问题请询问用户
  - **注意**: jitterBuffer.test.ts 有一个预先存在的测试失败，与本次修改无关

## Notes

- 所有任务（包括测试任务）都是必需的
- 每个任务引用具体需求以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证具体示例和边界情况
