# 监控插件：截图、帧时钟、播放观测与资源生命周期

本页描述 1.1.0的可选插件 API；是否已发布以 npm registry 为准。监控/无人机能力的优先级与验收条件见 [推进路线](monitoring-roadmap.md)。

## 不依赖 UI 的截图

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import {
  createSnapshotPlugin, type SnapshotHandle
} from '@bimccfyra/fyraplayer/plugins/snapshot';

let snapshots: SnapshotHandle | undefined;
const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/live.m3u8' }],
  plugins: [createSnapshotPlugin({
    maxWidth: 1920,
    onHandle: handle => { snapshots = handle; }
  })]
});
await player.init();
await player.play();

// 在已解码首帧后，由业务按钮调用。
async function takeSnapshot() {
  const result = await snapshots!.capture({ type: 'image/jpeg', quality: 0.85 });
  return result; // { blob, width, height, filename, ts, mediaTime }
}
```

`maxWidth/maxHeight` 保持宽高比且不放大；PNG 为默认格式，JPEG/WebP 可配置 quality。`ts` 是复制像素时的客户端毫秒时间，`mediaTime` 是此时 video.currentTime；两者都不是摄像机采集时间或 KLV PTS。浏览器回退图像格式时 filename 按实际 Blob MIME 生成。

没有解码帧、非法尺寸/quality、Canvas 不可用、跨域污染或编码失败会拒绝 Promise。应用需让媒体服务器提供合适的 CORS 响应，并配置 video 的跨域属性；插件无法绕过浏览器限制。

切源请求、会话 epoch 变化或 video.loadstart 会取消正在编码的截图；销毁立即取消请求，旧 handle 的后续调用拒绝为 AbortError。新 Player 无活动会话时拒绝新捕获。底层浏览器编码可能继续执行，但迟到结果不再交付。独立函数 `captureSnapshot(video, { signal, ...options })` 可不用 Player；调用方自行管理源变更与 signal。

截图只复制 HTMLVideoElement 的视频像素。DOM 标注、字幕覆盖层、KLV 面板、PanoramaLite WebGL 视口及实验 canvas 输出不包含在内。插件不下载、不上传、不存储；现有 UI 截图按钮复用同一函数并继续执行下载。

## 显示帧时钟

```ts
import {
  createFrameClockPlugin, mediaTimeToPts90k,
  type FrameClockHandle, type MediaPtsAnchor
} from '@bimccfyra/fyraplayer/plugins/frame-clock';

let clock: FrameClockHandle | undefined;
let anchor: MediaPtsAnchor | null = null; // 由同一流的媒体时间轴信息设置
const frameClockPlugin = createFrameClockPlugin({
  fallback: 'none',
  onHandle: handle => { clock = handle; },
  onReset: reason => {
    if (reason !== 'seeking') anchor = null;
  },
  onError: error => console.warn('frame clock consumer', error)
});
// 把 frameClockPlugin 放入 PlayerOptions.plugins。
function displayedPts(): bigint | null {
  const sample = clock?.getLatest();
  return sample && anchor ? mediaTimeToPts90k(sample.mediaTime, anchor) : null;
}
```

支持时使用 requestVideoFrameCallback 的 `metadata.mediaTime`。`precision: 'video-frame'` 表示采样自浏览器提交给合成器的帧，不保证摄像机采集时刻、物理屏幕扫描时刻或回调完全不迟到。`observedAt/expectedDisplayTime` 使用浏览器高精度时间基准，单位为毫秒，不是 UTC。宽高和 presentedFrames 来自该帧回调。

不支持帧回调时，默认从 timeupdate/loadeddata/seeked 提供 `precision: 'media-event'` 的低精度样本；`fallback: 'none'` 则保持无样本。插件不增加轮询计时器，不改变播放速率。

新 Player 的 sessionchange、原生 seeking/loadstart/emptied 会增加帧时钟自己的 epoch、取消旧回调并清空 latest，恢复后重新采样；旧宿主仍监听 sourcechange。一个切源可能触发多个 reset，epoch 不是源编号，也不同于样本的 sessionEpoch（核心会话 epoch）。loaded 事件保持会话 epoch 时不重复 reset。应用应在已知新媒体时间基准后设置锚点。销毁后 latest 为 null。onFrame 应保持轻量，多路场景把地图/业务 UI 更新集中到应用渲染调度中。

`mediaTimeToPts90k` 只做单位和原点换算，保留 bigint 的原点精度；非有限值或超出安全整数的 tick 差值会抛 RangeError。它不发现锚点，不展开 33 位回绕，也不计算网络端到端延迟。

新 Player 的 `sample.source` 来自报告的播放会话，sessionEpoch 标识会话；旧宿主仍使用请求源。核心 fallback 与 WS 内部回退已覆盖，其他未报告的内部路径变化仍不能自动追踪，见 [播放会话](playback-sessions.md)。实验解码若输出 canvas 而没有驱动 video，帧时钟可能无样本；应由该渲染器提供自己的显示时钟。完整的 KLV 边界见 [fyraklv 接入](klv-integration.md)。

## 首帧、卡顿与恢复

```ts
import { createPlaybackHealthPlugin, type PlaybackHealthHandle }
  from '@bimccfyra/fyraplayer/plugins/playback-health';

let health: PlaybackHealthHandle | undefined;
const healthPlugin = createPlaybackHealthPlugin({
  stallThresholdMs: 2000, checkIntervalMs: 250, maxEvents: 100,
  fallback: 'none',
  onHandle: handle => { health = handle; },
  onEvent: (event, snapshot) => console.log(event.type, snapshot.status)
});
// 放入 PlayerOptions.plugins；每路分别创建插件。
// 离屏窗口或应用已知的停止绘制阶段：health?.setSuspended(true)。
// 恢复观测：health?.setSuspended(false)。
// 随时读取：health?.snapshot()。
```

`firstFrameMs` 从本次 load/switch/reconnect/discontinuity 开始计到第一次观察到帧，包含等待用户点击播放的时间，不是单独的解码耗时。尝试选择 Tech 和同次 loaded 不重置起点；核心重连的 recoveryMs 从新的 reconnect epoch 起算，不含此前重连退避。事件 observedAt/startedAt 使用 performance.now() 毫秒，不是 UTC 或采集时间。

`precision` 为 video-frame、media-event、external-frame 或 unavailable。默认复用 rVFC；无该 API 时默认使用媒体事件估算，fallback:none 不产生这种估算。无帧 API 的严格模式只根据显式 waiting/stalled 观察等待，不能检测静默冻结。新媒体时间推进才结束卡顿，重复帧时间以及 ready/play 事件不算恢复。

只有有播放意图、活动会话、可见且不在 seeking 时启动检查定时器。用户暂停、结束、停止、销毁、页面隐藏和 setSuspended 会结束当前观察区间，不报告成功恢复；已观察的区间仍计入总数/总时长。超过 max(1000ms, 4×checkIntervalMs) 的检查间隙记录 observation-gap，排除无法观察的时间。后台检测依赖页面可见性与定时器间隙，不能识别所有系统遮挡或判断网络/解码的根本原因。

snapshot 包含状态、当前 epoch/源、最近媒体时间、firstFrameMs/recoveryMs、当前 stall、生命周期累计 stallCount/totalStallMs、lastError 和最多 maxEvents 条事件。时间轴切换清空帧/单次耗时，生命周期累计保留。错误仅按已有证据分为 autoplay、transport、media-network、decode、unsupported、timeout 或 unknown。事件/快照回调失败交给 onError，不影响播放。

默认向现有 qos 出口发出 PLAYBACK_STALL 与 PLAYBACK_RECOVERED，可被 metrics/diagnostics 消费；emitQos:false 可关闭。插件不发起请求、不重连、不改变播放速度，不估算没有远端时钟依据的端到端延迟。检查参数必须合法：阈值 100..60000ms、间隔 50..阈值、事件容量 1..1000。

自定义 canvas/WebTransport 渲染可选 frameSource:external，由渲染器实际完成绘制后调用 `reportFrame({mediaTime, sessionEpoch})`。新核心要求 epoch 与当前会话相同，旧回调不能更新新会话；未选择 external 时注入返回 false。WebTransport 示例使用原始 canvas 帧时间，避免 captureStream 的另一条时间轴。销毁取消定时器、帧回调和事件，旧 handle 保留 destroyed 快照。

浏览器验证入口 [browser-playback-health-smoke](../checks/browser-playback-health-smoke.mjs) 用原生 MP4 和真实 canvas captureStream 制造停止/恢复出帧，验证暂停和应用挂起排除、QoS 与资源释放。这是受控帧冻结验证，不是网络故障或物理屏幕冻结的根因诊断。

## 自定义插件的资源作用域

```ts
import type { PluginCtor } from '@bimccfyra/fyraplayer';

export const telemetryPlugin: PluginCtor = ({ player, lifecycle }) => {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const onStats = () => { /* 轻量采样；异步请求使用 controller.signal */ };
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    cancel();
    player.off('stats', onStats);
    lifecycle?.signal.removeEventListener('abort', cancel);
  };
  lifecycle?.onCleanup(destroy);
  lifecycle?.signal.addEventListener('abort', cancel, { once: true });
  if (lifecycle?.signal.aborted) destroy();
  else player.on('stats', onStats);
  return { destroy }; // 同时兼容没有 scope 的旧宿主
};
```

工厂是同步函数；异步工作放在 handle/回调中。Player 为每次插件注册提供独立的 lifecycle；类型上可选，以兼容已有自定义宿主。获取资源后应及时注册 onCleanup，初始化中途抛错才能回收已登记资源。未登记的任意副作用无法自动回滚。

同一注册重复 apply 不重复初始化；plugins 数组重复放入同一工厂仍是两个实例。按数组顺序安装，按相反顺序销毁，因此先放 provider、后放 consumer。先调用返回的 destroy（保留 this），再按逆序执行 scope cleanup；两处使用同一清理函数时必须幂等。Player.destroy 一开始便 abort 所有 scope，最终 destroy/cleanup 仍等待 Tech 加载队列；signal 需要插件主动响应。

`onPluginError({ plugin, phase, error })` 报告 setup/destroy/cleanup 失败；默认 console.warn。plugin 名来自工厂函数名，匿名工厂显示 anonymous，它不是稳定的业务标识。一个插件或错误报告回调失败不阻止其他插件清理。该回调不替代插件自身的异步错误处理。

目前无需新增插件依赖容器、自动排序、版本协商或运行时热装卸。独立子路径已有打包依赖门禁：snapshot、frame-clock、playback-health、metadata 不得引入 Player、UI、Tech 或第三方运行时依赖。
