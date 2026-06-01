# 解码能力总览

本文档总结当前 FyraPlayer 的解码能力，包含技术架构、已实现的能力、覆盖的编码/协议，以及后续可能规划。

## 1) 技术架构概览

FyraPlayer 采用「多技术栈（Tech）+ 统一事件与降级策略」的架构：

- Source 由 TechManager 选择适配 Tech（webrtc / hls / dash / fmp4 / ws-raw / file / gb28181）。
- 每个 Tech 独立负责拉流、容器解析、解码与渲染。
- 浏览器托管播放（native video / MSE / hls.js / dash.js）作为 HLS、DASH、fMP4、普通 MP4 的主路径，实际解码由浏览器、系统编解码器与硬件能力决定。
- WebCodecs 作为 ws-raw/file 等实验路径的硬解优先路径；WASM 作为 H.264 兜底解码器。
- H.265/HEVC 不承诺内置 WASM 软解。当前目标是把浏览器托管 H.265 路径的能力探测、codec string 选择和失败诊断做扎实。

核心解码管线（以 ws-raw 为例）：

```
WebSocket/WebTransport
  -> Demux(FLV/TS/AnnexB)
  -> JitterBuffer
  -> Decoder(WebCodecs 优先 / WASM 兜底)
  -> Renderer(WebGL/Canvas)
```

## 2) 已实现能力

### 2.1 WebCodecs 解码

- H.264：支持 Baseline/Main/High 等常见 profile，codec string 由 SPS 动态解析生成。
- H.265：支持 H.265（hvc1/hev1），codec string 由 VPS/SPS 动态生成；需要浏览器硬解能力支持。
- AV1 / VP9：可探测支持能力，用于判定是否可走 WebCodecs。
- 音频：AAC/Opus 通过 AudioDecoder。

### 2.2 浏览器托管 H.265 播放

- HLS：默认通过 hls.js + MSE；Safari/iOS 等不支持 hls.js MSE 时回退原生 HLS。播放器负责拉流、缓冲和事件归一化，真正 H.265 解码由浏览器/系统负责。
- fMP4：通过 MSE 追加 fMP4 segment。播放器会按 `mimeType`、`videoCodecString` 或 `codec: 'h265'` 构造 hvc1/hev1 候选，并用 `MediaSource.isTypeSupported()` 选择可用 MIME。
- MP4 文件：默认通过 `video.src` 原生播放；可选 WebCodecs MP4 路径仍以浏览器能力探测为准。
- 公共能力探测：`FyraPlayer.probeBrowserManagedCodecs()` 返回 native video 与 MSE 的 H.264/H.265 支持情况；`FyraPlayer.probeWebCodecs()` 仍只表示 WebCodecs 能力。

### 2.3 WASM 软解兜底

- H.264：默认 h264bsd 解码器（可替换/扩展）。
- H.265：当前不推进内置 WASM 软解，只保留为未来可能的可选增强方向。
- 适用场景：WebCodecs 不支持或浏览器能力不足时的兜底路径（当前主要用于 H.264）。

### 2.4 MSE 回退

- HLS（hls.js）/ DASH（dash.js）/ fMP4（MSE）等基于 MSE 的播放路径已实现。
- ws-raw / file / hls 在 WebCodecs 失败时可回退到 MSE（或 WASM）。

## 3) 覆盖编码与容器

### 3.1 视频编码

- H.264（WebCodecs + WASM）
- H.265（浏览器托管 MSE/native + WebCodecs；不含内置 WASM 软解）
- AV1（WebCodecs 探测）
- VP9（WebCodecs 探测）

### 3.2 音频编码

- AAC（WebCodecs）
- Opus（WebCodecs）

### 3.3 容器/比特流

- TS、FLV、AnnexB（ws-raw 解复用）
- fMP4（MSE）
- MP4（原生 video.src）

## 4) 覆盖协议/传输

- WebRTC
- HLS / DASH
- HTTP/HTTPS（文件与 fMP4）
- WebSocket / WebTransport（ws-raw）

## 5) 关键策略与现状说明

- codec string 动态生成：从 SPS/VPS 中解析 profile/level/compatibility，优先匹配实际码流。
- 能力探测：`MediaSource.isTypeSupported()` / `HTMLVideoElement.canPlayType()` 用于浏览器托管路径，`VideoDecoder.isConfigSupported()` 用于 WebCodecs 路径。
- 自动降级：WebCodecs 失败时优先切 MSE，必要时仅对 H.264 启用 WASM 兜底。
- H.265 策略：浏览器托管路径优先，要求正确的 `hvc1`/`hev1` codec string、容器形态和系统解码能力；不把 H.265 WASM 作为当前交付目标。
- 低延迟场景：ws-raw + WebCodecs 优先，必要时走 WASM。

## 6) 未来可能规划

- H.265 WASM 软解仅作为未来可能推进步骤：需要独立 decoder asset、Worker/SIMD/SharedArrayBuffer 能力、COOP/COEP 部署要求、性能边界和低分辨率兜底策略，不进入当前主线。
- WASM 解码器性能优化（多线程/SharedArrayBuffer / COOP/COEP 配置支持）当前仅面向已有 H.264 兜底路径。
- 更完整的 codec string 覆盖（H.264 High10/High422/High444）。
- 统一「解码决策引擎」：容器识别 -> SPS/VPS -> WebCodecs capability -> fallback。

---

如需更详细的实现细节，可参考：

- `docs/api.md`（API 与 Tech 说明）
- `docs/gb28181.md`（GB28181 网关适配边界）
