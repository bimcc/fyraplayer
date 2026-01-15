# FyraPlayer + Cesium 集成指南

使用 FyraPlayer 进行低延迟播放，将视频输出到 Cesium（通过 @beeviz/cesium），并桥接元数据到 @aspect/openklv 进行姿态/位置/时间同步。

## 依赖项

- `fyraplayer` - 播放器核心
- `@beeviz/cesium` - Cesium 集成（包含 FyraPlayerCesiumAdapter、VideoSource、UAVVisualizer）
- `@aspect/openklv` - KLV/MISB 元数据解析

## 适配器位置

> **重要**：Cesium 适配器**不在 fyraplayer 包内**，而是在 `@beeviz/cesium` 中。

| 组件                      | 所在包                        | 说明                              |
| ------------------------- | ----------------------------- | --------------------------------- |
| `FyraPlayerCesiumAdapter` | `@beeviz/cesium`              | 将 FyraPlayer 视频输出接入 Cesium |
| `KlvBridge`               | `fyraplayer/plugins/metadata` | 元数据事件桥接                    |

## 快速开始

```typescript
// 适配器从 @beeviz/cesium 导入（不是 fyraplayer）
import {
  FyraPlayerCesiumAdapter,
  VideoSource,
  UAVVisualizer,
} from "@beeviz/cesium";
import { KlvBridge } from "fyraplayer/plugins/metadata";
import { KLVStreamManager } from "@aspect/openklv";

const videoEl = document.querySelector("#video") as HTMLVideoElement;
const sources = [
  {
    type: "ws-raw",
    url: "wss://example.com/live.ts",
    codec: "h264",
    transport: "ts",
    metadata: { privateData: { enable: true } },
  },
];

// KLV 解析
const klvManager = new KLVStreamManager();
const bridge = new KlvBridge({
  parse: (evt) => klvManager.pushPacket(evt.raw, evt.pts),
  onData: (result) => {
    // 姿态/位置数据，传给 Cesium 可视化组件
    uav.updatePose(result);
  },
  onError: (err) => console.warn("KLV parse error", err),
});

// 创建适配器
const adapter = new FyraPlayerCesiumAdapter({
  video: videoEl,
  sources,
  techOrder: ["ws-raw", "hlsdash"],
  onMetadata: (evt) => bridge.handle(evt),
});

await adapter.init();

// Cesium 侧
const videoSource = new VideoSource(videoEl);
const uav = new UAVVisualizer(viewer, {
  /* options */
});
```

## 职责划分

| 层              | 职责                                                           |
| --------------- | -------------------------------------------------------------- |
| FyraPlayer      | 拉流/解码/协议降级，发出 `metadata` 事件（原始 payload + pts） |
| KlvBridge       | 事件转发，错误处理                                             |
| @aspect/openklv | KLV 语义解析、时间同步，输出姿态/位置数据                      |
| @beeviz/cesium  | 消费 videoEl 作为纹理，渲染 UAV/轨迹/视锥体                    |

## 提示

- 在 ws-raw Source 上启用元数据提取：`metadata.privateData.enable` 或 `metadata.sei.enable`
- FyraPlayer 核心不包含 KLV 解析逻辑，所有语义解析在 @aspect/openklv 中通过 KlvBridge 完成
