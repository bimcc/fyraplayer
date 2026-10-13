# 解码能力与支持口径

2026-10-13。H.265 并非只有 MSE 路径：普通 MP4 使用原生 video，HLS/DASH/fMP4 主要使用浏览器托管的 MSE/native 路径，WebCodecs 实验路径直接调用 VideoDecoder。浏览器、操作系统、容器和实际码流共同决定能否播放；探测通过不等于已解码真实媒体，更不保证使用硬件解码。

| 路径 | 配置探测 | 当前接入和限制 |
| --- | --- | --- |
| native video | video.canPlayType(MIME) | 普通 MP4/WebM；HLS 在对应浏览器使用原生回退。返回的是格式能力报告 |
| MSE | MediaSource.isTypeSupported(MIME) | HLS/hls.js、DASH/dash.js、direct fMP4、TS/FLV/mpegts.js；必须匹配封装与精确 codec string |
| WebCodecs | VideoDecoder.isConfigSupported(config) | WS/File 等既有实验管线，以及新的可选 WebTransport 视频 Tech；接收的是解复用后的编码访问单元 |
| H.264 WASM | 应用部署的 decoder asset | 旧实验管线中的 worker/decoder 适配；默认路径 /decoders/h264bsd/decoder.js 只是约定，npm 包不附带可用软解资产 |
| H.265 WASM | 未提供 | 当前没有内置 HEVC 软解兜底；需要服务端转码或显式提供兼容备用源 |

## H.265 选择

- MP4：默认 File/native；实际 H.265 支持以目标设备播放证据为准。
- HLS/DASH：由 hls.js/dash.js、MSE 或原生 HLS 与系统解码器共同处理。转封装不能解决浏览器不支持 HEVC 编码的问题，必要时服务端转码 H.264。
- direct fMP4：按 mimeType/videoCodecString/codec 提示构造 hvc1/hev1 候选，用 MSE 探测；正确的 init segment、hvcC 和媒体数据仍是必要条件。
- 新 [WebTransport 插件](webtransport.md)：独立 Tech，收到服务端精确配置后探测，HEVC 须 allowH265=true；只支持已分帧的视频，没有 TS/FLV 解复用、音频或 WASM 回退。
- 旧 ws-raw/File WebCodecs 管线：继续实验性质，不把编码字符串解析或 mock 测试等同于端到端播放承诺。

## 公共探测与示例显示

`FyraPlayer.probeBrowserManagedCodecs()` 分别返回 native 与 MSE 的 H.264/H.265 代表配置结果；`FyraPlayer.probeWebCodecs()` 返回 WebCodecs 代表配置结果，包括 AV1/VP9 等。它们没有探测用户全部输入 profile、位深或分辨率；AV1/VP9 报告支持不意味着新 WebTransport 协议接受这些编码。

示例页分别显示 native、MSE、WebCodecs 配置探测，并单独显示实际所选 Tech/可报告的 codec。实际播放证据应包含首帧、持续帧推进、错误事件和资源清理。isConfigSupported 无法证明硬件型号或实际硬件解码使用情况。

## 传输和回退边界

WebRTC 依赖协商出的浏览器编码能力；GB28181 是服务端控制/转换边界，见 [网关接入](gb28181.md)。新 WebTransport 使用 HTTP/3 可靠单向流和显式分帧；旧 ws-raw.webTransport 是 datagram 实验路径，两者不兼容。

既有实验管线的 MSE/WASM 回退各有资源、地址及容器前提，不能宣传统一的“任何协议自动降级”。新 WebTransport 只遍历显式备用 Source；同一个 WebTransport endpoint 不会直接交给 MSE。当前不包含客户端转码或全浏览器 HEVC 兼容。

结果以 [支持场景](supported-scenarios.md) 和 [带日期验证矩阵](playback-verification-matrix.md) 为准。弱网、长跑、多路容量和移动真机仍需各自验证。
