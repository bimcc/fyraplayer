# FyraPlayer 架构规范

本文档定义了 FyraPlayer 的目录结构和模块职责，作为开发时的参考指南。

## 项目概述

FyraPlayer 是一个通用低延迟 Web 播放器，支持 WebRTC、LL-HLS、WebSocket+WebCodecs 等多种播放技术，采用插件/中间件架构设计。

**设计原则**：FyraPlayer 是纯播放器，不包含渲染器特定的适配器（如 PSV、Cesium）。这些适配器应放在各自的项目中。

## 目录结构

```
fyraplayer/
├── .kiro/
│   └── steering/
│       └── architecture.md         # 本文档
├── src/
│   ├── core/                       # 核心模块（必须）
│   │   ├── eventBus.ts             # 事件总线，发布/订阅模式
│   │   ├── techManager.ts          # Tech 生命周期管理
│   │   ├── pluginManager.ts        # 插件注册与管理
│   │   ├── middleware.ts           # 中间件链
│   │   └── defaults.ts             # 默认配置项
│   │
│   ├── techs/                      # 播放技术（必须）
│   │   ├── tech-webrtc.ts          # WebRTC (WHIP/WHEP)
│   │   ├── tech-ws-raw.ts          # WebSocket + WebCodecs
│   │   ├── tech-hlsdash.ts         # HLS/DASH
│   │   ├── tech-gb28181.ts         # GB28181 国标流
│   │   ├── tech-file.ts            # 本地文件
│   │   ├── webrtc/                 # WebRTC 信令
│   │   └── wsRaw/                  # WS-Raw 解码管线
│   │
│   ├── render/                     # 渲染层（通用）
│   │   ├── baseTarget.ts           # 渲染目标抽象
│   │   └── canvasFrameBuffer.ts    # 帧→Canvas 缓冲
│   │
│   ├── ui/                         # UI 控件（可关闭）
│   │
│   ├── plugins/                    # 可选插件（播放相关）
│   │   ├── metadata/               # 元数据桥接（KLV 事件转发）
│   │   └── engines/                # 流媒体服务器 URL 转换
│   │
│   ├── types.ts                    # 主类型定义
│   ├── player.ts                   # FyraPlayer 主类
│   └── index.ts                    # 导出入口
│
├── docs/
│   └── api.md                      # API 文档（供其他项目引用）
├── tests/
├── package.json
└── README.md
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

播放器默认 UI，可通过 `ui: false` 关闭

### plugins/ - 可选扩展

按需引入，不影响核心包体积：

- `metadata/`: KLV 元数据桥接（只转发，不解析）
- `engines/`: 流媒体服务器 URL 转换

**注意**：渲染器特定的适配器已移至各自项目：

- PSV 适配器 → `@beeviz/fyrapano`
- Cesium 适配器 → `@beeviz/cesium`

## 层次关系

```
┌─────────────────────────────────────────────────────────────┐
│                        用户应用                              │
├─────────────────────────────────────────────────────────────┤
│  @beeviz/fyrapano    @beeviz/cesium    其他渲染器集成        │  ← 外部项目
├─────────────────────────────────────────────────────────────┤
│  plugins/metadata    plugins/engines                         │  ← 播放相关插件
├─────────────────────────────────────────────────────────────┤
│                          ui/                                 │  ← 默认 UI
├─────────────────────────────────────────────────────────────┤
│                       FyraPlayer                             │  ← 主入口
├─────────────────────────────────────────────────────────────┤
│     core/          techs/           render/                  │  ← 核心层
└─────────────────────────────────────────────────────────────┘
```

## 导出策略

```typescript
// fyraplayer 主入口
import { FyraPlayer } from "fyraplayer";

// fyraplayer 播放相关插件
import { EngineFactory } from "fyraplayer/plugins/engines";
import { KlvBridge } from "fyraplayer/plugins/metadata";
```

## 渲染器集成（官方推荐方案）

以下适配器**不在 fyraplayer 包内**，而是由各渲染器项目提供。
这是 fyraplayer 对接渲染器的官方推荐方案：

| 渲染器              | 适配器                    | 所在包             | 用途           |
| ------------------- | ------------------------- | ------------------ | -------------- |
| Photo Sphere Viewer | `FyraPlayerPsvAdapter`    | `@beeviz/fyrapano` | 全景直播       |
| Cesium              | `FyraPlayerCesiumAdapter` | `@beeviz/cesium`   | 无人机视频投影 |

```typescript
// PSV 全景集成（从 @beeviz/fyrapano 导入，不是 fyraplayer）
import { FyraPlayerPsvAdapter } from "@beeviz/fyrapano";

// Cesium 3D 集成（从 @beeviz/cesium 导入，不是 fyraplayer）
import { FyraPlayerCesiumAdapter } from "@beeviz/cesium";
```

**注意**：这些适配器是独立项目，fyraplayer 本身不包含任何渲染器特定代码。

## 设计原则

1. **核心轻量**: `core/` + `techs/` + `render/` 是最小可用集
2. **UI 可选**: 通过 `ui: false` 关闭，适配嵌入场景
3. **插件按需**: `plugins/` 全部可选，tree-shake 友好
4. **渲染通用**: `render/` 不依赖第三方库
5. **元数据分层**: 底层提取在 `demuxer/`，语义解析在业务层（openklv）
6. **渲染器分离**: PSV/Cesium 等渲染器适配器放在各自项目，fyraplayer 保持纯播放器定位
