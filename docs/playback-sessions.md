# 播放会话、时间轴与加载取消

本页描述 1.1.0-rc.1 候选的会话与取消契约。它解决“请求源与实际选中源不一致”和“旧时间轴结果继续被使用”的集成问题；不自动发现媒体 PTS 锚点或跨摄像机时钟。

## 请求源与播放会话

`getCurrentSource()` 继续返回 sources 中用户请求的源，保持旧 API 语义。`getPlaybackSession()` 返回当前选中播放尝试的浅拷贝或 null：

```ts
interface PlaybackSession {
  epoch: number;
  requestedSource: Source;
  source: Source;
  tech: TechName;
  status: 'loading' | 'loaded';
}
```

source 是 resolver、request/signal 中间件处理后，实际传入所选 Tech 的源，或 Tech 显式报告的替代源。它能区分主地址与备用地址；不是 HTTP 最终重定向 URL、HLS 分片 URL 或内部 rendition 的自动探测结果。getPlaybackSession 在 FyraPlayer 上始终存在，在 PlayerAPI 类型上可选以兼容已有插件宿主。

`loading` 表示已经选择并准备调用 Tech.load，`loaded` 只表示 Tech.load 完成，不意味着首帧、网络健康或播放成功。ready 仍是各 Tech 的既有就绪语义。加载开始、失败和销毁时 session 为 null；旧视频像素可能仍暂留在元素中，不应据此沿用旧会话状态。

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';

const player = new FyraPlayer({
  video: '#video',
  loadTimeoutMs: 15000,
  sources: [{
    type: 'hls', url: 'https://example.com/primary.m3u8',
    fallbacks: [{ type: 'hls', url: 'https://backup.example.com/live.m3u8' }]
  }]
});
let anchor: { mediaTime: number; pts90k: bigint } | null = null;
let epoch: number | undefined;
player.on('sessionchange', event => {
  if (event.epoch !== epoch) {
    epoch = event.epoch;
    anchor = null;
  }
  console.log(event.reason, event.session?.source, anchor);
});
await player.init();
```

会话 source 可能包含应用签名 URL/headers；向监控服务导出前由应用按需脱敏。

## 事件顺序

`sessionchange` 提供 `{ epoch, reason, session }`。epoch 在播放器内单调递增，不是 PTS、UTC、源索引或成功播放次数。

| reason | 语义 |
| --- | --- |
| load / switch / reconnect | 新加载请求使旧时间轴失效，session=null；队列尚未执行的旧请求可能被跳过 |
| selected | 已选中本次 Tech/source，status=loading；在 Tech.load 和它的同步 ready/metadata 之前通知 |
| loaded | Tech.load 完成，同一 epoch 更新 status，不清空这次已经收到的 metadata |
| failed | 加载尝试失败或核心重连耗尽，旧时间轴失效；下一个 selected 可对应备用 URL/Tech |
| fallback / discontinuity | Tech 显式报告内部传输/时间轴替换，epoch 增加 |
| stop | 主动停止立即取消加载/重连并清空会话；保留插件和请求源，可复用 Player |
| destroy | 实例进入终止状态，session=null |

一次切源通常包含多个 epoch。消费方按 epoch 变化失效缓存，不按事件数统计切源成功。`sourcechange` 仍是用户 switchSource 请求的兼容通知，不覆盖重连或内部回退。监听函数内重入切源/销毁会使旧尝试失效，旧尝试不能继续开始加载或启动统计。

Tech 可以在新时间轴的数据交付前发出 EngineEvent `streamchange`，payload 为 `{ reason: 'fallback' | 'discontinuity', source?: Source }`；source 缺省时保留地址但更新 epoch。WS 实验→MSE 路径已接入，默认 WS MSE 也报告规范化的 pipeline=mse；WebRTC 的内部备用 Source 重载也报告 fallback。已经停止的实验管线不会再交付 metadata。

核心重连会创建新 epoch。HLS 内部 discontinuity、WebRTC 原地重协商/码流切换、设备端无感重启和其他 Tech 内部回退尚未全部接入；不能把未报告变化的流视为自动完成时钟追踪。旧 GB Tech invite 的媒体地址还没有更新 session.source；新 gb-gateway resolver 返回标准 Source，已能报告所选媒体地址。WebTransport 配置替换先清空原始帧 clock 再发出 discontinuity，原始微秒通过 onFrame/getLatestFrame 与 metadata.timestampUs 交付；应用 KLV 缓冲和旧异步解析随 epoch 失效，不能与 captureStream 时间混用。33 位 TS PTS 回绕仍需应用/传输适配层一致展开，WebTransport 的换算时钟不施加该掩码。

## 插件响应

- frame-clock 监听会话 epoch，取消旧回调、清空样本；新样本包含 sessionEpoch 和报告的实际 source。旧宿主仍使用 sourcechange/请求源。
- snapshot 在 epoch 变化时取消正在编码的图片，包括地址不变的重连/内部回退；无活动会话时不接受新捕获。原生 loadstart 的取消逻辑继续保留。
- 应用层 createFyraKlvPlugin 清空旧 service 缓冲，并调用 onTimelineReset；应用在这里清空 PTS 锚点。mediaTimeToPts 的第二参数为会话 source、第三参数为 session；无会话不入库/查询。没有新契约的旧宿主保持原逻辑。

显示时钟、元数据出口和锚点必须同时可靠；实验 canvas 与默认 MSE 的限制见 [KLV 接入](klv-integration.md)。

## 加载取消与超时

加载中间件的 context 和 TechLoadOptions 增加可选 signal。新切源、stop 或 destroy 立即取消旧加载；正常重复 init 仍合并。PlayerOptions.loadTimeoutMs 为每个 resolve/request/signal 中间件步骤及每个 Tech.load 尝试的超时，默认不启用（0），负数或非有限值拒绝构造。中间件可以用自己的 timeoutMs 覆盖全局值。control 中间件保持原来的超时旁路语义。

`stop()` 同步使旧代次失效、清除重连和统计计时器、清空 session 并发出 stop 事件；返回 Promise 等待旧 load 结束及资源释放。它不注销插件，停止后可 play/init 或 switchSource；紧接着切源会排在旧清理之后。pause 遇到加载、错误或已排定的重连时执行 stop，正常播放仍暂停。应用的取消操作应直接调用 stop/destroy，避免排在未结束的加载命令后面。旧 Tech 事件和停止前的 play/control 延续不会重新启动播放。非协作 Tech 仍需自行结束，不能保证它的最终清理立即完成。

超时会 abort 本步骤/尝试的 signal，reason.name 为 TimeoutError；切源/停止/销毁为 AbortError。单个 Tech 超时不取消整个备用源链，下次尝试使用新 signal。TechSelectionError.causes 保留每次失败原因。此超时不是首帧截止时间，也不是整条备用源链总预算；Tech.load 返回后不再计时，不限制后续后台恢复。

中间件迟到的返回值不再进入后续链，reject 也有接收方。中间件自己的外部副作用需要主动响应 signal。TechManager 等待 Tech.load 自身结束，再 destroy 并复用同一实例；不通过 Promise.race 强行复用仍在后台运行的 Tech。

| 路径 | 本轮覆盖 |
| --- | --- |
| resolve/request/signal 中间件 | 取消后停止等待、忽略迟到结果；步骤计时器/监听器被清理 |
| 自定义 Tech | 收到 signal，需要在异步阶段检查并停止创建资源、终结 load；忽略信号仍可能延迟切源/销毁 |
| DASH 模块/脚本加载 | 取消等待，不再创建 dash player；共享脚本下载本身可继续供其他实例使用 |
| File 标准 TS/FLV 的 mpegts loader、能力探测 | 取消等待，迟到模块不会创建播放器；原生文件路径检查取消 |
| WS 默认/回退 MSE 的 mpegts loader | 取消等待并 stop adapter，迟到模块失效 |
| WebRTC WHEP/WHIP | offer/local SDP、ICE 等待、POST、响应体和 remote SDP 响应取消；停止后关闭旧 PC，不继续应用迟到 SDP；HTTP timeout 覆盖响应体读取 |
| WebRTC OME | WS 连接、offer 等待、SDP answer 等待响应取消；监听器在连接前注册，避免即时 offer 丢失；setup 在 answer 发送后完成，不表示已出首帧 |
| direct fMP4 HTTP/WS | sourceopen、HTTP headers、WS open 响应取消；关闭 socket、取消 reader、撤销对象 URL；旧 read/回调不会操作新流；HTTP 启动错误向上传播 |
| GB invite + MSE | invite fetch/JSON、MSE loader 等待响应取消；停止部分 MSE，迟到 invite 不创建适配器、不写入旧会话 |
| 新 GB gateway | resolve invite/控制等待响应取消；迟到会话按应用注入的 release 回调回收，备用源期间保持会话 |
| 新 WebTransport Tech | session.ready、incoming stream/read、配置探测和首个解码输出响应取消；关闭 session/decoder/readers/capture tracks，独立首帧期限默认 15 秒 |
| WS/File/HLS 实验解码循环 | 尚未全部改造成协作式通用取消，保留原有自身超时/清理机制；不能承诺统一截止时间 |

加载成功后解除外部 load signal 的连接，继续播放的 HTTP reader、WebSocket 和 PC 使用 Tech 自己的生命周期；后续切源/销毁由 Tech 清理。这避免加载步骤结束后误停正常流。WebRTC 销毁还清除 metadata、连接、ICE、丢包观测和 data-channel heartbeat 定时器。

取消浏览器的 GB invite/WHEP POST 不保证服务端会话尚未创建。旧 Tech 不自动补发 gb:bye 或 WHEP DELETE；新 gb-gateway 有注入的 release 才执行应用策略，响应丢失仍需要网关会话过期约定。通用 signal 只用于 load，不覆盖所有 control；新 gateway.control 使用独立会话取消信号。

第三方实现应使用 signal 控制 fetch 或其他可取消 API，检查每个 await 之后是否已取消，并确保失败后的 destroy 能清理部分资源。业务模块加载器无法真正中止时，可以取消等待，但必须保证迟到结果不会重新操作 video/创建资源。浏览器没有安全的通用方式强制终止任意 Promise。

后续继续补齐其余 Tech 的取消、真实 discontinuity 报告与能力查询，再推进冻结观测及多路预算。见 [监控路线](monitoring-roadmap.md)。
