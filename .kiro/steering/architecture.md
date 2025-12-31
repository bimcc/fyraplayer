# FyraPlayer 架构规范

本文档定义了 FyraPlayer 的目录结构和模块职责，作为开发时的参考指南。

## 目录结构

```
src/
├── core/                           # 核心模块（必须）
│   ├── eventBus.ts                 # [已有] 事件总线，发布/订阅模式
│   ├── techManager.ts              # [已有] Tech 生命周期管理，自动选择播放技术
│   ├── pluginManager.ts            # [已有] 插件注册与管理
│   ├── middleware.ts               # [已有] 中间件链，请求/响应拦截
│   └── defaults.ts                 # [已有] 默认配置项
│
├── techs/                          # 播放技术（必须）
│   ├── tech-webrtc.ts              # [已有] WebRTC 播放，支持 WHIP/WHEP/自定义信令
│   ├── tech-ws-raw.ts              # [已有] WebSocket 原始流播放（FLV/TS/裸流）
│   ├── tech-hlsdash.ts             # [已有] HLS/DASH 播放，基于 hls.js/shaka
│   ├── tech-gb28181.ts             # [已有] GB28181 国标流播放
│   ├── tech-file.ts                # [已有] 本地文件播放
│   ├── hlsConfig.ts                # [已有] HLS 配置工具
│   │
│   ├── webrtc/                     # WebRTC 信令实现
│   │   ├── signalAdapter.ts        # [已有] 信令适配器工厂
│   │   ├── ovenSignaling.ts        # [已有] OvenMediaEngine WebSocket 信令
│   │   └── signaling.ts            # [已有] WHIP/WHEP 标准信令
│   │
│   └── wsRaw/                      # WS-Raw 解码管线
│       ├── pipeline.ts             # [已有] 解码管线调度
│       ├── demuxer.ts              # [已有] 解复用器入口
│       ├── demuxer/                # [已有] 解复用器实现
│       │   ├── index.ts
│       │   ├── ts-demuxer.ts       # TS 流解复用
│       │   ├── flv-demuxer.ts      # FLV 流解复用
│       │   ├── sei.ts              # SEI 数据解析
│       │   ├── utils.ts
│       │   └── types.ts
│       ├── webcodecsDecoder.ts     # [已有] WebCodecs 解码器
│       ├── decoderWorker.ts        # [已有] Worker 线程解码
│       └── renderer.ts             # [已有] 帧渲染到 Canvas
│
├── render/                         # 渲染层（通用，必须）
│   ├── baseTarget.ts               # [已有] 渲染目标抽象基类
│   └── canvasFrameBuffer.ts        # [重命名] 原 panoramaRenderer.ts，帧→Canvas 缓冲
│
├── ui/                             # UI 控件（默认启用，可关闭）
│   ├── index.ts                    # [迁移] 从 plugins/ui/ 迁移
│   ├── shell.ts                    # [迁移] 播放器外壳容器
│   ├── controls.ts                 # [迁移] 播放/暂停/进度条/音量控件
│   ├── fullscreen.ts               # [迁移] 全屏切换
│   ├── events.ts                   # [迁移] UI 交互事件
│   ├── styles.ts                   # [迁移] CSS 样式
│   └── types.ts                    # [迁移] UI 类型定义
│
├── plugins/                        # 可选扩展（按需引入）
│   │
│   ├── psv/                        # PSV 全景集成
│   │   ├── FyraPsvAdapter.ts       # [迁移] 从 integrations/psv/，PSV 播放器适配
│   │   └── plugin.ts               # [迁移] PSV 插件封装
│   │
│   ├── cesium/                     # Cesium 3D 集成
│   │   └── FyraCesiumAdapter.ts    # [迁移] 从 integrations/cesium/，Cesium 视频贴图
│   │
│   ├── metadata/                   # 元数据处理
│   │   └── KlvBridge.ts            # [迁移] 从 integrations/metadata/，KLV 事件桥接
│   │                               # 注：klvParser/timeSync 在 ref/beeviz/klv，播放器只负责事件转发
│   │
│   ├── engines/                    # 流媒体服务器适配（URL 转换）
│   │   ├── engineFactory.ts        # [迁移] 从 adapters/，引擎工厂
│   │   ├── urlConverter.ts         # [迁移] 从 adapters/，URL 转换工具
│   │   ├── constants.ts            # [迁移] 从 adapters/engines/
│   │   ├── UrlBuilder.ts           # [迁移] URL 构建器
│   │   ├── ZlmEngine.ts            # [迁移] ZLMediaKit 适配
│   │   ├── SrsEngine.ts            # [迁移] SRS 适配
│   │   ├── MediaMtxEngine.ts       # [迁移] MediaMTX 适配
│   │   ├── MonibucaEngine.ts       # [迁移] Monibuca 适配
│   │   ├── OvenEngine.ts           # [迁移] OvenMediaEngine 适配
│   │   └── TencentEngine.ts        # [迁移] 腾讯云适配
│   │
│   ├── metrics.ts                  # [已有] 播放质量监控统计
│   ├── reconnect.ts                # [已有] 断线自动重连
│   └── storage.ts                  # [已有] 播放状态持久化
│
├── utils/                          # 工具函数
│   ├── webcodecs.ts                # [已有] WebCodecs 能力检测
│   └── auth/                       # 鉴权工具（可选）
│       ├── tencentSign.ts          # [新增] 腾讯云 URL 签名
│       └── alibabaSign.ts          # [新增] 阿里云 URL 签名
│
├── types/                          # 类型声明
│   └── mp4box.d.ts                 # [已有] mp4box 类型定义
│
├── types.ts                        # [已有] 主类型定义（Source, PlayerOptions 等）
├── player.ts                       # [已有] FyraPlayer 主类
└── index.ts                        # [已有] 导出入口（需更新）
```

## 模块职责

### core/ - 核心模块
- `eventBus.ts`: 事件发布/订阅，组件间通信
- `techManager.ts`: 管理播放技术的生命周期，根据 Source 类型自动选择 Tech
- `pluginManager.ts`: 插件的注册、初始化、销毁
- `middleware.ts`: 请求/响应中间件链
- `defaults.ts`: 默认配置值

### techs/ - 播放技术
每个 Tech 负责一种播放协议的完整实现：
- `tech-webrtc.ts`: WebRTC 低延迟播放
- `tech-ws-raw.ts`: WebSocket 接收原始流 + WebCodecs 解码
- `tech-hlsdash.ts`: HLS/DASH 自适应码率播放
- `tech-gb28181.ts`: 国标 GB28181 流播放
- `tech-file.ts`: 本地文件播放

### render/ - 渲染层
通用的帧输出抽象，不依赖任何第三方库：
- `baseTarget.ts`: 渲染目标抽象接口
- `canvasFrameBuffer.ts`: VideoFrame/Video → Canvas 转换

### ui/ - UI 控件
播放器默认 UI，可通过 `ui: false` 关闭：
- 播放/暂停按钮
- 进度条（直播流隐藏）
- 音量控制
- 全屏切换

### plugins/ - 可选扩展
按需引入，不影响核心包体积：
- `psv/`: Photo Sphere Viewer 全景集成
- `cesium/`: Cesium 3D 地图视频贴图
- `metadata/`: KLV/MISB 元数据解析
- `engines/`: 流媒体服务器 URL 转换

## 层次关系

```
┌─────────────────────────────────────────────────────────────┐
│                        用户应用                              │
├─────────────────────────────────────────────────────────────┤
│  plugins/psv    plugins/cesium    plugins/engines    ...    │  ← 可选扩展
├─────────────────────────────────────────────────────────────┤
│                          ui/                                 │  ← 默认 UI
├─────────────────────────────────────────────────────────────┤
│                       FyraPlayer                             │  ← 主入口
├─────────────────────────────────────────────────────────────┤
│     core/          techs/           render/                  │  ← 核心层
│  (事件/管理)     (播放技术)      (通用渲染)                   │
└─────────────────────────────────────────────────────────────┘
```

## 导出策略

```typescript
// src/index.ts - 主入口（含 UI）
export * from './types.js';
export * from './player.js';
export * from './core/eventBus.js';
export * from './core/techManager.js';
export * from './techs/tech-webrtc.js';
export * from './techs/tech-hlsdash.js';
export * from './techs/tech-ws-raw.js';
export * from './techs/tech-gb28181.js';
export * from './render/canvasFrameBuffer.js';
export * from './ui/index.js';

// src/plugins/index.ts - 插件入口（按需引入）
export * from './psv/FyraPsvAdapter.js';
export * from './cesium/FyraCesiumAdapter.js';
export * from './metadata/KlvBridge.js';
export * from './engines/engineFactory.js';
```

## 使用方式

```typescript
// 基础播放（带 UI）
import { FyraPlayer } from 'fyra';

// 无 UI 模式（嵌入场景）
import { FyraPlayer } from 'fyra';
const player = new FyraPlayer({ ui: false, ... });

// PSV 全景
import { FyraPlayer } from 'fyra';
import { FyraPsvAdapter } from 'fyra/plugins';

// URL 转换
import { FyraPlayer } from 'fyra';
import { EngineFactory } from 'fyra/plugins';
```

## 迁移计划

### 需要迁移的目录

| 原位置 | 新位置 | 说明 |
|--------|--------|------|
| `integrations/psv/` | `plugins/psv/` | PSV 适配器 |
| `integrations/cesium/` | `plugins/cesium/` | Cesium 适配器 |
| `integrations/metadata/` | `plugins/metadata/` | KLV 桥接 |
| `adapters/` | `plugins/engines/` | 引擎工厂和各引擎实现 |
| `plugins/ui/` | `ui/` | UI 控件提升到顶层 |

### 需要重命名的文件

| 原名称 | 新名称 | 说明 |
|--------|--------|------|
| `render/panoramaRenderer.ts` | `render/canvasFrameBuffer.ts` | 更准确的命名 |

### 需要新增的文件

| 文件 | 功能 |
|------|------|
| `utils/auth/tencentSign.ts` | 腾讯云 URL 签名 |
| `utils/auth/alibabaSign.ts` | 阿里云 URL 签名 |

### 外部依赖（不在播放器内）

| 位置 | 功能 | 说明 |
|------|------|------|
| `ref/beeviz/klv/` | KLV/MISB 解析、时间同步 | 业务层，播放器通过 KlvBridge 桥接 |

## 元数据处理职责边界

播放器与业务层在元数据处理上有明确的职责分工：

```
┌─────────────────────────────────────────────────────────────┐
│  业务层 (ref/beeviz/klv)                                     │
│  - KLV/MISB 语义解析（解析具体字段含义）                      │
│  - 时间同步（PTS 与地图时间轴对齐）                           │
│  - 姿态数据应用（驱动 Cesium 视角）                           │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ KlvBridge 桥接
                              │ (监听 metadata 事件，转发给解析器)
┌─────────────────────────────────────────────────────────────┐
│  FyraPlayer (plugins/metadata/KlvBridge.ts)                  │
│  - 发出 metadata 事件                                        │
│  - 事件类型: 'sei' | 'private-data'                          │
│  - 事件内容: { raw: Uint8Array, pts: number, ... }           │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ 回调 onSEI / onPrivateData
                              │
┌─────────────────────────────────────────────────────────────┐
│  techs/wsRaw/demuxer/ (解复用层)                             │
│  - sei.ts: 从 H.264/H.265 NAL 单元提取 SEI payload           │
│  - ts-demuxer.ts: 从 TS PES 提取私有数据 (stream_type 0x06)  │
│  - 只提取原始字节，不解析语义                                 │
└─────────────────────────────────────────────────────────────┘
```

### 各层职责

| 层次 | 位置 | 职责 | 输出 |
|------|------|------|------|
| 解复用层 | `techs/wsRaw/demuxer/` | 从流中提取 SEI/私有数据 | 原始字节 + PTS |
| 播放器层 | `player.ts` | 发出 `metadata` 事件 | MetadataEvent |
| 桥接层 | `plugins/metadata/KlvBridge.ts` | 事件转发、错误处理 | 调用业务解析器 |
| 业务层 | `ref/beeviz/klv/` | KLV 语义解析、时间同步 | 结构化姿态数据 |

### 设计原则

- **播放器不解析 KLV 语义**：只负责提取原始字节并发出事件
- **SEI 解析属于解复用**：`sei.ts` 在 `demuxer/` 下，因为它是从 NAL 单元提取 payload 的底层操作
- **业务逻辑外置**：KLV/MISB 标准解析、时间同步等放在 `ref/beeviz/klv/`，可独立迭代

## 设计原则

1. **核心轻量**: `core/` + `techs/` + `render/` 是最小可用集
2. **UI 可选**: 通过 `ui: false` 关闭，适配嵌入场景
3. **插件按需**: `plugins/` 全部可选，tree-shake 友好
4. **渲染通用**: `render/` 不依赖 PSV/Cesium/Three.js 等第三方库
5. **信令分层**: 通用信令在 `techs/webrtc/`，厂商特殊信令在 `plugins/engines/`
6. **元数据分层**: 底层提取在 `demuxer/`，语义解析在业务层
