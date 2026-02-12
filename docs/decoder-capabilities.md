# 解码能力总览

本文档总结当前 FyraPlayer 的解码能力，包含技术架构、已实现的能力、覆盖的编码/协议，以及后续可能规划。

## 1) 技术架构概览

FyraPlayer 采用「多技术栈（Tech）+ 统一事件与降级策略」的架构：

- Source 由 TechManager 选择适配 Tech（webrtc / hls / dash / fmp4 / ws-raw / file / gb28181）。
- 每个 Tech 独立负责拉流、容器解析、解码与渲染。
- WebCodecs 作为硬解优先路径；WASM 作为 H.264 兜底解码器；MSE 作为容器层面的通用回退。

核心解码管线（以 ws-raw 为例）：

```
WebSocket/WebTransport
  -> Demux(FLV/TS/AnnexB/PS)
  -> JitterBuffer
  -> Decoder(WebCodecs 优先 / WASM 兜底)
  -> Renderer(WebGL/Canvas)
```

## 2) 已实现能力

### 2.1 WebCodecs 解码

- H.264：支持 Baseline/Main/High 等常见 profile，codec string 由 SPS 动态解析生成。
- H.265：支持 H.265（hvc1/hev1），codec string 由 VPS/SPS 动态生成；需要浏览器硬解能力支持。
- AV1 / VP9：可探测支持能力，用于判定是否可走 WebCodecs。
- 音频：AAC/Opus 通过 AudioDecoder；G.711 通过内置 PCM 解码。

### 2.2 WASM 软解兜底

- H.264：默认 h264bsd 解码器（可替换/扩展）。
- H.265：不做 WASM 软解（仅保留 WebCodecs 硬解路径）。
- 适用场景：WebCodecs 不支持或浏览器能力不足时的兜底路径（主要用于 H.264）。

### 2.3 MSE 回退

- HLS（hls.js）/ DASH（dash.js）/ fMP4（MSE）等基于 MSE 的播放路径已实现。
- ws-raw / file / hls 在 WebCodecs 失败时可回退到 MSE（或 WASM）。

## 3) 覆盖编码与容器

### 3.1 视频编码

- H.264（WebCodecs + WASM）
- H.265（WebCodecs）
- AV1（WebCodecs 探测）
- VP9（WebCodecs 探测）

### 3.2 音频编码

- AAC（WebCodecs）
- Opus（WebCodecs）
- G.711 PCMA/PCMU（内置 PCM 解码）

### 3.3 容器/比特流

- TS、FLV、AnnexB、PS（ws-raw 解复用）
- fMP4（MSE）
- MP4（原生 video.src）

## 4) 覆盖协议/传输

- WebRTC
- HLS / DASH
- HTTP/HTTPS（文件与 fMP4）
- WebSocket / WebTransport（ws-raw）

## 5) 关键策略与现状说明

- codec string 动态生成：从 SPS/VPS 中解析 profile/level/compatibility，优先匹配实际码流。
- 能力探测：VideoDecoder.isConfigSupported() 作为 WebCodecs 适配判断。
- 自动降级：WebCodecs 失败时优先切 MSE，必要时仅对 H.264 启用 WASM 兜底。
- 低延迟场景：ws-raw + WebCodecs 优先，必要时走 WASM。

## 6) 未来可能规划

- WASM 解码器性能优化（多线程/SharedArrayBuffer / COOP/COEP 配置支持）。
- 更完整的 codec string 覆盖（H.264 High10/High422/High444）。
- 统一「解码决策引擎」：容器识别 -> SPS/VPS -> WebCodecs capability -> fallback。

---

如需更详细的实现细节，可参考：

- `docs/api.md`（API 与 Tech 说明）
- `docs/gb28181.md`（GB28181 管线说明）
