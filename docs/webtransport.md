# WebTransport + WebCodecs 视频插件

2026-10-14，1.1.0-rc.1 候选中的实验能力。公开入口 `/plugins/webtransport`，显式注册独立 Tech；Player 默认不安装它。浏览器必须提供安全上下文、WebTransport、VideoDecoder、EncodedVideoChunk 和 Canvas2D/captureStream。服务端必须提供 HTTP/3 WebTransport 会话及下述帧契约，普通 HTTPS 视频 URL 不能直接使用。

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import { createWebTransportTechPlugin } from '@bimccfyra/fyraplayer/plugins/webtransport';

const player = new FyraPlayer({
  video: '#video', muted: true,
  sources: [{
    type: 'webtransport', url: 'https://media.example.com/video',
    // 单一 fyra-media 格式，无需版本配置；元数据可选。
    // HEVC 需另设 allowH265:true，且设备和码流必须兼容。
    fallbacks: [{type:'hls',url:'https://media.example.com/live.m3u8'}]
  }],
  plugins: [createWebTransportTechPlugin({
    startupTimeoutMs: 15000, maxDecodeQueue: 8,
    onFrame(frame, info) {
      // 同步回调；需要持有帧时 clone()，消费后自行 close()。
      console.log(info.timestamp, info.mediaTime);
    }
  })]
});
await player.init(); // 成功加载须建立会话、支持配置并实际解码首帧。
if (player.getState() === 'error') throw new Error('Video startup failed');
await player.play();
// 页面退出：await player.destroy();
```

## 当前范围

服务端创建一个可靠单向视频流，客户端只消费首个 incoming unidirectional stream。可靠流避免首版实现 datagram 分片、重排和丢包恢复，也存在流内队头阻塞，不能据此承诺比 WebRTC 延迟更低。服务端应限制发送积压并采用短 GOP、无 B 帧及适合设备的码率和分辨率。

当前支持 H.264/H.265 视频访问单元，可选携带原始 private-data/SEI 记录，没有音频、A/V 同步、拥塞自适应、DRM、录像索引或 seek。服务端提前完成容器解复用；插件不接受任意 TS、FLV、PS、MP4 或裸字节分片。暂停保持连接并丢弃视频，恢复等待下一个关键帧；不是 VOD 暂停点继续播放。video 的倍速/音量属性不提供此视频直播路径的倍速或音频功能。

画面经 Canvas2D 绘制再 captureStream 进入共享 video，兼容现有 UI/截图；存在复制和输出时钟开销，暂未采用 Worker/OffscreenCanvas 或直接 VideoFrame 渲染。onFrame 表示已解码并绘制到 canvas，不能等同于屏幕已呈现。

## `fyra-media` 帧契约

每条记录先发送 4 字节无符号大端 body 长度，再发送 body；没有 magic 前缀。只有这一套格式，不发送版本字段，也不进行格式版本协商。网络 read() 可任意分片或合并，客户端增量组包。导出 encodeTransportConfig / encodeTransportChunk 供 JS 服务端生成同一格式。

| body 偏移 | 配置记录 kind=1 | 视频记录 kind=2 |
| --- | --- | --- |
| 0 | uint8=1 | uint8=2 |
| 1 | UTF-8 JSON 起始 | uint8 flags：0=delta、1=key；其他值拒绝 |
| 2 | JSON 延续 | uint64 BE timestamp，微秒 |
| 10 | JSON 延续 | uint32 BE duration，微秒；0=未指定 |
| 14 | JSON 延续 | 完整 encoded access unit，非空 |

配置示例：`{"codec":"avc1.42C00C","codedWidth":320,"codedHeight":200}`。codec 必须是实际码流的 avc1/avc3/hvc1/hev1 完整字符串。可选 description:number[] 是 avcC/hvcC 记录：存在时采用相应长度前缀访问单元；省略时采用 Annex B，关键帧携带所需 SPS/PPS 或 VPS/SPS/PPS。配置必须先于视频；新配置重建 decoder、等待关键帧并发出 discontinuity。

timestamp 在 JS 安全整数范围内且非负，在一次配置期间必须非递减；因此不支持依赖 B 帧重排、PTS 回退的发送格式。重启/时间轴回退先发送新配置。尺寸 1..8192，像素不超过 33554432；description 最多 16384 字节，配置 body 最多 64KiB；默认每条 body 最多 2MiB，可配置 maxPacketBytes=64..16MiB。无效长度、未知 kind、配置错误、时间回退和 EOS 截断立即失败。

## 可选元数据与 KLV

统一解析器接受配置、视频及可选 kind=3 元数据记录。Source 不再提供 protocol 参数，解析器不再提供版本参数或严格视频兼容分支。服务端按是否有遥测决定发送哪些记录；同一个客户端可消费纯视频或带元数据的视频。

没有元数据时，播放器不等待元数据，也不创建 KLV 解析器、缓存或插值定时器，视频记录不增加字节。安装 KLV 插件也不是播放条件。服务端发送 kind=3 时，无 KLV 插件的客户端仍执行有上限的基础拆包、校验与通用 metadata 事件交付；不做 MISB 语义解析。要省去这部分网络与拆包开销，应让服务端停止发送元数据。导出 encodeTransportMetadata 供服务端生成记录。

| body 偏移 | 元数据记录 kind=3 |
| --- | --- |
| 0 | uint8=3 |
| 1 | uint8 subtype：1=private-data、2=SEI；其他值拒绝 |
| 2 | uint64 BE timestamp，原始微秒 |
| 10 | uint32 BE identifier：private-data 的 PID（0..8191）或 SEI payload type；0xffffffff=未指定 |
| 14 | 非空 raw payload，最多 65536 字节；完整 KLV/Local Set 或 SEI payload，不是 TS/PES 包 |

元数据同样需要先收到配置。timestamp 必须为安全非负整数，各 subtype 在一次配置期间独立非递减，不要求与交错的视频记录比较大小。新配置同时重置三个时间序列。每条记录还受 maxPacketBytes 约束；解析器按该总上限分配 body，收到 kind 后拒绝超过元数据上限的记录。

Tech 发出通用 MetadataEvent：pts=timestamp/1000 毫秒、timestampUs=原始微秒、raw，以及可选 pid/seiType。这里不填 pts90k，避免把换算时间冒充原始 MPEG-TS PTS。服务端必须给视频与元数据相同的时钟原点和微秒单位；把到达时间或 KLV 的 UTC 标签写入 timestamp 不能自动完成同步。

应用使用 [createWebTransportKlvIntegration](../examples/integrations/webtransport-klv.ts) 组合两个插件，注入独立 fyraklv.KLVStreamManager。两端通过 transportTimestampToPts90k 将微秒换为最近的 90kHz 整数刻度：`(BigInt(timestamp) * 9n + 50n) / 100n`，不经浮点秒数，也不截断为 33 位。换算后的值属于传输时间轴，非原始 TS PTS。详见 [KLV 接入](klv-integration.md)。

onHandle 提供 getLatestFrame()，返回最近 canvas 绘制帧的原始 timestamp 和 timelineId 副本。新配置先清空该时钟并发出 discontinuity，应用适配器清空 fyraklv 缓冲；新帧到来后恢复查询。stop/destroy 后返回 null。timelineId 是该 Tech 的配置代次，不能用于跨播放器校时。

元数据在暂停时继续交付；帧时钟停留在最后绘制帧，fyraklv 缓冲容量由应用/外部包控制，冻结太久可能超出查询范围。EOS 保留最后帧直到停止。若元数据晚于对应画面到达，本方案不等待、不回退画面，状态可能暂不可用；发送端宜先发送对应遥测并限制积压。本地验收验证原始时钟查询一致性，未测量屏幕与真实遥测的同步误差。

## 失败、取消与会话

- 默认启动期限 15 秒，覆盖 session.ready、首个流、配置和首个解码输出。超时/停止中止等待并关闭 transport、decoder、readers 与 capture tracks；迟到回调不能复活旧会话。
- Tech.load 的失败由 Player 归一为 error 事件/状态；现有 Player.init 不重新抛出这类加载错误。应用检查 error/getPlaybackSession 后决定是否重试，避免失败后紧接着 play 再次开流。
- 队列默认上限 8。当前 decoder 尚未输出首帧时，队列满只丢弃新输入，保留已提交的有界前缀，避免反复 reset 丢失首个关键帧；收到首帧后，因丢弃过参考帧而继续等待下一关键帧。此保护同样适用于配置更新、暂停恢复和队列追帧后的 decoder。启动仍受原有 15 秒期限约束，停止立即释放。
- 已输出画面后的队列溢出可 reset decoder 并丢弃到新关键帧；真正丢弃的输入才计入 droppedFrames。network.type=catchup 区分 reason=decode-queue-warmup（保留预热前缀）和 decode-queue（运行期重置）。队列上限只约束待解码任务，不保证发送端积压、解码内部缓存或端到端延迟。
- 启动失败时遍历显式 Source.fallbacks。WebTransport URL 不会作为 MSE/HLS 地址复用；备用源也需要各自的浏览器/容器能力。
- 运行期断连发出 error 与 fatal wt-close，核心按重连策略重新加载请求源；当前只有启动阶段遍历备用 Source。运行期改走 HLS 需应用定义切源策略。
- 视频流 FIN 时校验完整记录并 flush，发出 ended；连接、最后画面及 capture track 保留至 stop/destroy。服务端先结束视频流，避免 flush 前关闭会话。onFrame 抛错视为播放失败。

getPlaybackSession 报告实际 Tech/source；stats 包含 codec、decodedFrames、bytesReceived、mediaTime、尺寸与 droppedFrames。这里 droppedFrames 统计 Tech 主动跳过的输入 encoded chunk，不包含 decoder.reset 内部清掉的待解码任务，也不是屏幕丢帧率。

KLV 查询使用 getLatestFrame()/onFrame.info.timestamp（原始微秒）；captureStream 的 video.currentTime 与 frame-clock 的显示时间属于另一时间轴。当前 canvas 绘制回调不能保证屏幕呈现精度；语义解析继续由独立 fyraklv 承担。

## H.265、证书和旧路径

HEVC 需 Source.allowH265=true，收到精确配置后执行 VideoDecoder.isConfigSupported；报告支持后 decode 仍可能失败。没有 HEVC WASM 或自动转码，也不保证硬件解码，见 [能力口径](decoder-capabilities.md)。

生产使用浏览器信任的 HTTPS 证书。测试可传插件 options.serverCertificateHashes：`[{algorithm:'sha-256',value:Uint8Array(32)}]`；浏览器仍校验证书类型/有效期。fixture 使用两天有效期的本机 P-256 证书，哈希不进入 Source/产品预设。

旧 ws-raw.webTransport 保留为 datagram 实验路径，与此可靠流协议不兼容，不作为新接入入口；其 TS/FLV/WASM 与取消限制保持原有范围。

## 从工作区旧接口迁移

此前的 `fyra-video-v1` / `fyra-media-v2` 已合并为唯一名称 `fyra-media`，无需把最新格式重新编号为 v1。这是未发布实验接口的收敛：

- 从 Source 中删除 `protocol`，基本配置只需 `{type:'webtransport',url:'https://…'}`。
- 将 `new TransportVideoParser(maxPacketBytes, protocol)` 改为 `new TransportVideoParser(maxPacketBytes)`；省略上限时使用 `new TransportVideoParser()`。
- 删除 `WebTransportProtocol` 类型和 `WEBTRANSPORT_VIDEO_PROTOCOL` 导入；`WEBTRANSPORT_MEDIA_PROTOCOL` 现为固定名称 `'fyra-media'`，用于诊断。`network` 的 `wt-open` 事件也报告该名称，它不是可选配置或线上协商值。
- 配置、视频和元数据的记录字节均未改变；已按上述记录发送数据的服务端无需重新封装，也无需为纯视频补发元数据。自有网关若另行校验旧协议名称，应同步更新应用约定。

历史验收记录保留当时名称；当前接入以本页契约为准。任意 TS/FLV/MP4 字节或普通视频 URL 仍需服务端转换为上述 HTTP/3 会话与帧格式。

## 验证

[HTTP/3 fixture](../checks/fixtures/webtransport-video.py) 用 ffmpeg 生成 H.264/HEVC Annex B，aioquic 创建真实 QUIC 连接，安装见 [本地 fixture](development/fixtures.md)。[浏览器检查](../checks/browser-webtransport-smoke.mjs) 验证纯视频及有元数据但未安装 KLV 插件的播放、原生传输、实际解码/非空画面、原始 PTS、暂停恢复、挂起首帧停止、显式 MP4 备用源和清理；HEVC 按设备探测后验证，不支持时明确记录。设置 FYRA_KLV_PROJECT 后增加外部真实 KLVStreamManager、逐帧遥测标记、时间重启和清理验收。结果见 [验证矩阵](playback-verification-matrix.md)，不扩大到真机移动端、长跑或公网弱网。
