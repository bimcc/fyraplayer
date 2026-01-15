# FyraPlayer 集成方案

## 概述

FyraPlayer 是一个纯播放器，专注于低延迟直播（WebRTC/WS-Raw/HLS/DASH/GB28181）。
渲染器集成（PSV 全景、Cesium 3D）由各自的项目提供适配器。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户应用                              │
├─────────────────────────────────────────────────────────────┤
│  @beeviz/fyrapano    @beeviz/cesium                         │  ← 渲染器项目（含适配器）
├─────────────────────────────────────────────────────────────┤
│  plugins/metadata    plugins/engines                         │  ← fyraplayer 插件
├─────────────────────────────────────────────────────────────┤
│                       FyraPlayer                             │  ← 播放器核心
└─────────────────────────────────────────────────────────────┘
```

## 职责划分

| 层          | 包                            | 职责                                          |
| ----------- | ----------------------------- | --------------------------------------------- |
| 播放器核心  | `fyraplayer`                  | 拉流/解码/协议降级/重连，发出 `metadata` 事件 |
| 元数据桥接  | `fyraplayer/plugins/metadata` | 转发元数据事件，不解析语义                    |
| 引擎适配    | `fyraplayer/plugins/engines`  | URL 转换（ZLM/SRS/MediaMTX 等）               |
| PSV 集成    | `@beeviz/fyrapano`            | 全景直播，包含 `FyraPlayerPsvAdapter`         |
| Cesium 集成 | `@beeviz/cesium`              | 视频投影，包含 `FyraPlayerCesiumAdapter`      |
| KLV 解析    | `@aspect/openklv`             | MISB/KLV 语义解析、时间同步                   |

## 渲染器适配器

> **重要**：适配器不在 fyraplayer 包内，而是在各渲染器项目中。

### PSV 全景集成

```typescript
// 从 @beeviz/fyrapano 导入（不是 fyraplayer）
import { FyraPlayerPsvAdapter } from "@beeviz/fyrapano";

const adapter = new FyraPlayerPsvAdapter({
  sources: [{ type: "webrtc", url: "..." }],
  video: videoElement,
});
await adapter.init();
```

### Cesium 3D 集成

```typescript
// 从 @beeviz/cesium 导入（不是 fyraplayer）
import { FyraPlayerCesiumAdapter } from "@beeviz/cesium";

const adapter = new FyraPlayerCesiumAdapter({
  sources: [{ type: "ws-raw", url: "...", codec: "h264", transport: "ts" }],
  video: videoElement,
  onMetadata: (evt) => {
    /* KLV 处理 */
  },
});
await adapter.init();
```

## 数据流

```
后端 URL → EngineFactory → FyraPlayer Source[]
                              │
                              ▼
                         FyraPlayer
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
         videoEl        metadata 事件    VideoFrame
              │               │               │
              │               ▼               │
              │          KlvBridge            │
              │               │               │
              │               ▼               │
              │        @aspect/openklv        │
              │               │               │
              ▼               ▼               ▼
┌─────────────────────────────────────────────────────┐
│  PSV (全景)  │  Cesium (3D 投影)  │  其他渲染器     │
└─────────────────────────────────────────────────────┘
```

## 设计原则

1. **fyraplayer 保持纯播放器定位**：不包含渲染器特定代码
2. **适配器在渲染器项目中**：PSV 适配器在 fyrapano，Cesium 适配器在 beeviz/cesium
3. **元数据只透传不解析**：KLV 语义解析在 @aspect/openklv
4. **引擎适配可选**：plugins/engines 按需引入，不膨胀核心
