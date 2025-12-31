# FyraPlayer x PSV x Cesium 一体化集成方案

## 目标
- 低延迟直播统一入口（webrtc/ws-raw/gb28181/hls/dash），一套解码/回退。
- 全景展示：Photo Sphere Viewer (PSV) 使用 Fyra 的输出，保持低延迟和回退策略。
- 三维投射：Cesium 将 Fyra 输出的视频/元数据贴到地形/3D Tiles，实现孪生/轨迹/FOV。
- 元数据：ws-raw 私有数据/SEI 透传，交给 beeviz/klv 做 MISB/KLV 解析和时空对齐。
- 分层清晰，可持续维护，复用已有 livepano、beeviz 成果。

## 职责划分
- **Fyra 核心**：拉流/解码/回退/重连，产出 `HTMLVideoElement`/`VideoFrame` 与原始 `metadata` 事件（私有数据/SEI）。不做 KLV 语义解析，不做三维渲染。
- **render/**：平面渲染（renderer.ts），可选全景渲染（panoramaRenderer.ts，VideoFrame + WebGL）。可 `canvas.captureStream()` 喂 `<video>`，不处理生命周期。
- **adapters/**：EngineFactory/EngineAdapter，把 zlm/srs/mediamtx/monibuca/oven 等 URL 转 Fyra `Source`。可搬 livepano 的 Engine 实现与配置。
- **integrations/**
  - `psv/FyraPsvAdapter.ts`：管理 Fyra 播放，输出视频/canvas 给 PSV；可选 panoramaRenderer/captureStream；可复用 livepano 的视口追踪/质控策略。
  - `cesium/FyraCesiumAdapter.ts`：管理 Fyra 播放，video/canvas → `@beeviz/cesium` 的 `VideoSource`，把元数据交给 KlvBridge，再喂给 UAV/投射组件。
  - `metadata/KlvBridge.ts`：订阅 Fyra `metadata` 事件（原始 payload+PTS），调用 `@beeviz/klv` 解析/同步，输出姿态/位置/时间轴给上层。
- **beeviz 依赖**（外部包，直接引用，不搬代码）：`@beeviz/klv`（KLV/MISB 解析+同步）、`@beeviz/cesium`（VideoSource/UAVVisualizer/投射）、`@beeviz/core`（工具）。

## 目录结构（Fyra 仓库）
```
src/
  core/                      # 现有核心，保持不动
  techs/                     # 现有协议 tech
  render/
    renderer.ts              # 平面渲染
    panoramaRenderer.ts      # 可选全景渲染
  adapters/
    engineFactory.ts
    engines/…                # livepano 的 zlm/srs/mediamtx/monibuca/oven 等可搬
  integrations/
    psv/FyraPsvAdapter.ts
    cesium/FyraCesiumAdapter.ts
    metadata/KlvBridge.ts
examples/
  panorama-psv.html
  cesium-video.html
docs/
  integration-psv.md
  integration-cesium.md
  adapters.md
examples/
  panorama-psv.html       # Fyra + PSV 全景示例
  cesium-video.html       # Fyra + Cesium/KLV 示例

## PSV plugin hookup
- Keep the PSV plugin pattern: implement `src/integrations/psv/FyraPsvAdapter.ts` as a Photo Sphere Viewer plugin (extends AbstractPlugin / register/destroy), internally using FyraPlayer for playback.
- Bundle a standalone entry (e.g. `dist/fyra-psv-plugin.js` UMD/ESM) and re-export it from the package.
- Usage on the PSV side:
  ```js
  import PhotoSphereViewer from '@photo-sphere-viewer/core';
  import { FyraPsvAdapter } from 'fyraplayer/dist/fyra-psv-plugin.js'; // or npm package name
  PhotoSphereViewer.registerPlugin(FyraPsvAdapter);

  const psv = new PhotoSphereViewer({
    container: '#psv',
    panorama: 'placeholder.jpg', // placeholder; plugin provides the live texture
    plugins: [
      [FyraPsvAdapter, {
        video: document.querySelector('#fyra-video'), // video/canvas used internally by plugin
        sources: yourFyraSources,                      // Fyra Source list
        techOrder: ['webrtc','ws-raw','hlsdash']      // optional
      }]
    ]
  });
  ```
- Plugin duties: create/manage FyraPlayer, forward ready/play/pause/error/network/stats/metadata to PSV/UI, feed PSV with the video/canvas (plain or panoramaRenderer/captureStream). PSV must explicitly import/register the plugin; it is not auto-loaded.
```

## 数据流/调用流
1) 后端 URL → `adapters/engineFactory` → Fyra `Source[]`（含 fallback）  
2) FyraPlayer（核心）→ 解码/回退 → 输出 `videoEl`/`VideoFrame`，并发 `metadata` 事件（私有数据/SEI 原始 payload+PTS）。如需低延迟 VideoFrame 直贴，使用 ws-raw 的 `setFrameHook`（WebCodecs 路径）。  
3a) PSV 路径：FyraPsvAdapter → PSV（可用 panoramaRenderer/canvas/captureStream）  
3b) Cesium 路径：FyraCesiumAdapter → `@beeviz/cesium` VideoSource/投射；元数据经 KlvBridge → `@beeviz/klv` → UAV/FOV/轨迹  

## 复用点
- livepano：EngineFactory/Engine 实现，PSV 插件流程（视口追踪、质控策略）。
- beeviz/cesium：VideoSource、UAVVisualizer、投射/相交工具。
- beeviz/klv：KLV/MISB 解析、时间同步、插值。
- Fyra 已有：ws-raw metadata 抽取（TS 私有流/SEI）、回退/重连、gb28181 控制、WebCodecs/WASM/G.711 解码。

## 路线图
1) 适配层打通
   - `FyraCesiumAdapter`：接 Fyra 视频 → beeviz/cesium；`KlvBridge`：接 Fyra metadata → beeviz/klv。
   - `FyraPsvAdapter`：接 Fyra 视频 → PSV，全景展示（先 `<video>` 路径）。
2) EngineAdapter 收敛：搬 livepano EngineFactory/engines，产出 Fyra Source + fallback。
3) 示例/文档：更新 `panorama-psv.html`、`cesium-video.html`，撰写 integration docs。
4) 全景渲染优化（可选）：接入 panoramaRenderer（VideoFrame→WebGL 球贴图），低延迟全景。
5) 兼容/测试：协议回归（webrtc/ws-raw/hls/dash/gb），回退/重连，PSV/Cesium 渲染，metadata→KLV 对齐。

## 取舍与原则
- Fyra 不内置 KLV 语义解析/时间同步，保持轻量；只透传 metadata 事件。
- 三维/元数据高级逻辑在 beeviz 包；通过 integrations 层胶合。
- 渲染一套实现（canvas/WebGL），按需输出纹理/MediaStream，不重复写 `<video>` 渲染。
- EngineAdapter 可选：核心不自带具体 zlm/srs/mediamtx 等实现，如需引擎转换可在 adapters/engines 中按需注册或单独发包，避免膨胀核心。
