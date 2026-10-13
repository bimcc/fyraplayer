# FyraPlayer 与 fyraklv

KLV/MISB 解析属于独立的 [fyraklv](https://github.com/bimcc/fyraklv) 项目。FyraPlayer 只负责播放和通用元数据出口。两包保持独立，集成插件由应用持有。

## 两种接入

1. 只要解析结果：使用 `createMetadataPlugin({ parse, onData, onError })` 注入外部解析器。`MetadataBridge` 是通用桥接类，`KlvBridge` 及其 options 类型仍作为兼容别名保留。会话 epoch 变化或插件销毁后不再交付旧异步解析结果/错误；旧宿主通过 sourcechange 失效。
2. 要按视频时间查询状态：使用 [应用层 createFyraKlvPlugin 示例](../examples/integrations/fyraklv.ts)，注入 fyraklv 的 `KLVStreamManager`，显式提供时间轴映射。

示例代码在本仓库用相对路径导入播放器类型。复制到应用时，将它改为从 `@bimccfyra/fyraplayer` 导入；工厂本身不是播放器或 fyraklv 的已发布导出。

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import { KLVStreamManager, type DroneState } from 'fyraklv';
import {
  createFrameClockPlugin, mediaTimeToPts90k,
  type FrameClockHandle, type MediaPtsAnchor
} from '@bimccfyra/fyraplayer/plugins/frame-clock';
import { createFyraKlvPlugin, type FyraKlvHandle } from './fyraklv.js';

let handle: FyraKlvHandle<DroneState> | undefined;
let clock: FrameClockHandle | undefined;
// 应由当前源的媒体时间戳锚点提供；未知时不渲染同步状态。
let anchor: MediaPtsAnchor | null = null;
// 应用在确认本次加载的时间基准后设置 anchor = { mediaTime, pts90k }。

const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://example.com/live.ts',
    codec: 'h264',
    transport: 'ts',
    pipeline: 'experimental',
    metadata: { privateData: { enable: true } }
  }],
  plugins: [createFrameClockPlugin({
    fallback: 'none',
    onHandle: value => { clock = value; },
    onReset: reason => { if (reason !== 'seeking') anchor = null; }
  }), createFyraKlvPlugin({
    createService: () => new KLVStreamManager(),
    onTimelineReset: () => { anchor = null; },
    getMediaTime: () => clock?.getLatest()?.mediaTime ?? null,
    mediaTimeToPts: seconds => anchor ? mediaTimeToPts90k(seconds, anchor) : null,
    onHandle: value => { handle = value; },
    onError: error => console.warn('KLV integration', error)
  })]
});
await player.init();
// 在应用已有的渲染循环中调用；null 表示没有可用状态。
const state = handle?.getState();
console.log(state);
```

frame-clock 已纳入 1.1.0-rc.1 候选，见 [插件 API](monitoring-plugins.md)。上例展示严格的同步查询：没有显示帧或时间锚点就返回 null。实验 WS 管线若只输出 canvas，没有驱动 video，不能由该插件获得可靠帧时钟；应将 getMediaTime 换成渲染器确认的显示时间，或直接使用 getStateAtPts。默认 MSE 虽可能有 video 帧回调，却没有同等 metadata 数据出口，两项能力必须分别验证。

## 时间轴契约

| 值 | 单位与含义 |
| --- | --- |
| `MetadataEvent.pts` | number 毫秒，兼容现有 API |
| `MetadataEvent.pts90k?` | bigint，TS PES 提供的原始 33 位、90 kHz PTS；可选，非 UTC |
| `MetadataEvent.timestampUs?` | number，WebTransport 的原始微秒时间；与同流视频共用原点，不是 UTC，也不是原始 TS PTS |
| `player.currentTime` | video 元素的媒体时间，秒；实验 canvas/帧输出场景必须核对它是否持续推进 |
| `FrameClockSample.mediaTime` | video 帧回调的媒体时间，秒；精度由 precision 标明，仍需要同流 PTS 锚点 |
| fyraklv 查询参数 | bigint，90 kHz PTS，与输入帧属于同一时间轴 |

插件优先使用 pts90k，其次使用 timestampUs 的精确整数换算；都缺失时用 `BigInt(Math.round(pts * 90))`，不能恢复毫秒舍入丢失的精度。视频秒数同样先取整再转 bigint，避免浮点值直接转换抛错。

单位换算不等于时间轴对齐。不能默认首个 KLV PTS 等于 video.currentTime 的零点，也不能拿数据到达时间代替显示帧时间。示例的 anchor 必须来自同一源的媒体锚点。33 位回绕、流重启和 discontinuity 需要应用或传输适配层在喂入及查询两端一致展开时间轴，并更新映射；当前示例不自动解决这些问题。

getMediaTime 是可选注入：不提供时沿用 player.currentTime；提供时 null/非有限值代表暂不可查询，不偷偷回退为旧时钟。getStateAtPts 可以直接使用应用确认的 bigint 显示帧 PTS。frame-clock 的 epoch 只表示浏览器媒体生命周期变化，不能替代 TS discontinuity、重启或 PTS 回绕识别。

新 Player 的 `sessionchange` 在 epoch 变化时清空 service，并调用 `onTimelineReset`；应用在回调中清空锚点，在当前会话基准确认后重新设置。loaded 状态更新不改变 epoch、不重复清空数据。mediaTimeToPts 的第二参数是报告的实际播放源，第三参数是当前 session；无 session 时不查询/入库。旧宿主继续通过 sourcechange 清空缓冲、用请求源映射。

seek 保留当前源缓冲；帧时钟在 seeking 时清空，取得新帧后恢复查询，超出缓冲时返回值由 fyraklv 的查询契约决定。Player 开始销毁时 scope signal 立即使旧 handle 返回 null、停止入库；最终清理解绑监听并销毁 service。

sourcechange 仍表示显式 switchSource 请求，getCurrentSource() 仍表示请求源。现在所选备用地址、核心重连与 WS 实验→MSE 变化会更新 session/epoch，适配器能丢弃旧缓冲；它们仍不会自动提供新时间锚点。HLS 内部 discontinuity、WebRTC 内部重新协商及设备无感重启尚未全面接入，应用必须通过可用协议证据识别并重新对齐。详见 [会话契约](playback-sessions.md)。

## 提取边界与离线处理

WebTransport 可透传完整 KLV 或 demux 后的 Local Set。播放器不解析 MISB，不需要额外 metadata.enable 或版本开关；统一协议接受可选元数据记录。SEI 也透传，但下面的 KLV 应用适配器仅消费 private-data。

WS TS 的 private-data/SEI 提取目前接在实验管线上；默认 MSE 或实验失败后回退 MSE 不产生同等 metadata 事件。安装解析插件不会增加底层数据出口。File WebCodecs 的 TS 路径也可透传原始 PTS，但需要满足该实验路径的解码条件；原生文件/MSE 播放不承诺提取。

私有 PES 按声明长度跨 TS 包/网络分片拼装并去除填充，未完成的有界包在下一次起始时丢弃；无界包最多缓存 4 MiB、在下一次起始时交付。当前不支持跨 TS 包的 PES 头，也没有播放器 demux 的最终无界包 flush 契约，不能当通用离线 KLV 解复用器。

离线 TS、服务端 metadata-only 分析直接使用 fyraklv：
```ts
const manager = new KLVStreamManager();
await manager.loadFromBuffer(tsArrayBuffer);
const state = manager.getInterpolatedStateAtPts(targetPts90k);
manager.destroy();
```

不要将已经从播放器提取的 KLV 字节再交给 TS demux；应调用 `processLiveData(raw, pts90k)`。PSV/Cesium/投影展示属于应用或独立渲染器包。

## WebTransport 原始时钟接入

[应用示例](../examples/integrations/webtransport-klv.ts) 每个播放器创建一套独立服务与 handle；该工厂没有作为 SDK 导出。复制到应用后，把源代码导入改为 `/plugins/webtransport` 和播放器公开类型入口，保留本地 fyraklv.ts 适配器。

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import { KLVStreamManager } from 'fyraklv';
import { createWebTransportKlvIntegration } from './webtransport-klv.js';

const integration = createWebTransportKlvIntegration({
  createService: () => new KLVStreamManager(),
  onError: error => console.warn('KLV', error)
});
const player = new FyraPlayer({
  video: '#video', muted: true,
  sources: [{type:'webtransport',url:'https://media.example.com/metadata'}],
  plugins: integration.plugins
});
await player.init();
if (player.getPlaybackSession()?.status === 'loaded') await player.play();
// 应用渲染循环：查询最后 canvas 绘制帧的原始时间，不使用 captureStream currentTime。
const state = integration.getState();
// 页面退出：await player.destroy();
```

微秒通过 `(BigInt(timestampUs) * 9n + 50n) / 100n` 换为最近的 90kHz 整数，输入与查询保持同一时轴，不伪造 MetadataEvent.pts90k、不做 33 位掩码。新配置清空帧时钟与 KLV 缓冲，停止后 getState 返回 null。发送端共同时间基准、迟到遥测、暂停缓存及屏幕呈现精度限制见 [WebTransport 协议](webtransport.md)。
