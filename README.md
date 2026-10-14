# FyraPlayer

通用低延迟 Web 播放 SDK，支持 WebRTC、HLS/LL-HLS、DASH、HTTP/WS fMP4、FLV/TS 和本地文件。当前拟发布版本 **1.1.0**，发布范围和升级步骤见 [发布说明](RELEASE_NOTES.md)，变化见 [CHANGELOG](CHANGELOG.md)。

从 [文档导航](docs/README.md) 开始；架构以 [当前架构](docs/architecture.md) 为准，支持承诺以 [支持范围](docs/supported-scenarios.md) 和带日期的 [验证矩阵](docs/playback-verification-matrix.md) 为准。1.0.0 商业基线记录已经归档，不等于全浏览器、全协议支持。

## 安装与基础播放

本版先从生成的本地 tarball 安装；npm latest 仍以 registry 为准，普通无版本安装不包含尚未发布的候选能力。

```sh
npm install /absolute/path/bimccfyra-fyraplayer-1.1.0.tgz
```

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/live.m3u8' }],
  autoplay: true,
  muted: true
});
player.on('error', error => console.error(error));
await player.init();
// 页面退出时：
await player.destroy();
```

并发 init 合并加载，快速切源以最新请求为准；destroy 可重复调用，但销毁后需创建新实例。Tech 和中间件需要完成自身加载 Promise，详情见 [生命周期](docs/architecture.md)。

本版新增 getPlaybackSession/sessionchange，区分请求源与实际选中源，并用 epoch 使旧同步状态失效；新增 loadTimeoutMs 和加载 signal。取消覆盖尚未包含全部协议，详见 [播放会话与取消](docs/playback-sessions.md)。

本版提供 `await player.stop()`，立即取消加载与重连并等待播放资源释放，保留插件和源，可继续 play/init/switchSource。加载或重连中调用 pause 也会停止；正常播放仍为暂停。示例页提供独立停止按钮，错误地址停止后可以直接重新加载。

## 功能与插件

| 能力 | 接入方式 |
| --- | --- |
| HLS/LL-HLS | 内建 hls Tech；运行时依赖 hls.js |
| WebRTC | 内建 WHEP/WHIP/Oven 信令路径；需服务端与浏览器能力匹配 |
| HTTP/WS direct fMP4 | 内建 fmp4 Tech，非 HLS 清单路径 |
| FLV/TS 与 GB28181 网关输出 | 默认 MSE；应用提供 mpegts.js |
| GB28181 开流/控制集成 | 新增可选 [gb-gateway](docs/gb28181.md)，应用回调解析标准 Source；旧 Tech 保留兼容 |
| WebTransport + WebCodecs | 可选 [Tech 插件](docs/webtransport.md)，HTTP/3 可靠流；单一 fyra-media 格式，视频与可选原始元数据共享时钟；实验、无音频 |
| 本地 MP4/WebM | 浏览器原生文件播放；TS/MTS/FLV 走可选 mpegts.js |
| DASH | 显式安装 createDashTechPlugin |
| UI、诊断、鉴权、存储、录制 API、性能指标 | 可选插件，入口见 [插件职责](docs/pluginization-map.md) |
| 无 UI 截图、显示帧时钟 | 新增可选 [snapshot / frame-clock](docs/monitoring-plugins.md)，纳入本版 |
| 轻量全景 | 可选 [PanoramaLite](docs/panoramalite.md)，图片/视频等距柱状投影 |
| KLV/MISB | 播放器提取 raw metadata；独立 fyraklv 解析与同步 |
| PSV/Cesium 等外部渲染器 | 应用或渲染器包持有 [桥接](docs/render-bridges.md) |

核心不会自动创建 UI：
```ts
import { createUiComponentsPlugin } from '@bimccfyra/fyraplayer/plugins/ui-components';
// 在 PlayerOptions.plugins 中加入：
createUiComponentsPlugin({ target: '.player-shell' });
```

本版包含移动端适配：默认行内播放、44px 触摸按钮、窄屏“更多”菜单、全景单指拖动/双指缩放，以及容器全屏不可用时的页面内全屏。接入和手机预览见 [移动端播放](docs/mobile-playback.md)。已验证 Chromium 移动模拟，真机 iOS/Android 仍待复核。

H.265 可走 native、MSE 或 WebCodecs，取决于浏览器、系统、容器和真实码流；配置探测不代表已实际解码或硬解。示例页分开显示三类探测与当前播放路径，详细说明见 [解码能力](docs/decoder-capabilities.md)。高级类型提供 WebTransport 实验入口，GB 网关表单只在选择兼容接入时显示。

`/core` 是兼容的广泛导出入口，不是已经拆分的最小播放内核。消费方只导入公开 exports。

监控/无人机场景优先推进多路、低延迟与 KLV 同步，职责、已实现能力和后续验收见 [推进路线](docs/monitoring-roadmap.md)。插件新增可选 lifecycle 作用域及 onPluginError，支持初始化失败回收、协作取消和逆序清理。

新增 [四路监看示例](examples/multiview.html) 与 [应用层调度说明](docs/multiview.md)：播放/启动名额、焦点优先、离屏/后台释放、返回限流和每路健康观察。快捷键按播放器焦点隔离。该示例不等于多路设备容量或跨路同步承诺。

## 可选播放依赖

DASH 在 Vite 应用中将 vendor 当资源发布：
```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import { createDashTechPlugin } from '@bimccfyra/fyraplayer/plugins/dash';
import dashJsScriptUrl from '@bimccfyra/fyraplayer/vendor/dash.all.min.js?url';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'dash', url: 'https://example.com/live.mpd' }],
  plugins: [createDashTechPlugin({ scriptUrl: dashJsScriptUrl })]
});
await player.init();
```

也可安装 dashjs 并提供 `dashjsLoader: () => import('dashjs')`。仅把 source 写为 dash 不会注册 Tech。

TS/FLV/GB fallback 需要应用提供 mpegts.js；它是 optional peer，其 1.8.0 安装链包含 GitHub tarball，请按环境管理依赖。
```ts
const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'ws-raw', url: 'https://example.com/live.flv', codec: 'h264', transport: 'flv' }],
  mpegtsLoader: () => import('mpegts.js')
});
```

本地文件使用 object URL 时要显式指定容器，例如 `{ type: 'file', url: blobUrl, container: 'flv' }`；.mts 对应 ts。销毁播放器后由应用 revokeObjectURL。实验 MP4 WebCodecs 路径另需 mp4boxLoader/全局 MP4Box。

## 元数据与 fyraklv

```ts
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw', url: 'wss://example.com/live.ts',
    codec: 'h264', transport: 'ts', pipeline: 'experimental',
    metadata: { privateData: { enable: true }, sei: { enable: true } }
  }]
});
player.on('metadata', event => {
  if (event.type === 'private-data') {
    const pts90k = event.pts90k ?? BigInt(Math.round(event.pts * 90));
    console.log(event.raw, pts90k);
  }
});
```

默认 MSE 及回退 MSE 没有同等 metadata 提取事件。上例只是提取，不承诺任意 TS 都能实验播放。`pts` 为毫秒，`pts90k` 是可选原始 TS PTS；均不自动等于视频时间零点。

通用解析使用 `createMetadataPlugin` / `MetadataBridge`（保留 KlvBridge 兼容名）。需要 KLV 时间同步时，采用 [应用层插件示例](examples/integrations/fyraklv.ts) 注入 fyraklv.KLVStreamManager；见 [完整接入说明](docs/klv-integration.md)。两包没有相互依赖，离线 TS 直接交给 fyraklv。

WebTransport 统一使用 `fyra-media`，Source 无需版本参数，通过 `timestampUs` 透传可选原始元数据；没有元数据或 KLV 插件也能播放，不创建 KLV 服务。[组合接入示例](examples/integrations/webtransport-klv.ts) 用最近 canvas 绘制帧的原始时钟查询 fyraklv，配置重置和停止会清空状态；不使用 captureStream 的 currentTime，也不承诺屏幕呈现级同步。

## 开发与验证

开发工具需要 Node >=22.12（CI 使用 Node 24）与 pnpm 11.1.2。
```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check:release
```

- `pnpm dev`：Vite，打开 /basic.html 或 /panoramalite.html。
- `pnpm build:release`：ESM、类型声明、DASH vendor、IIFE 输出到 dist。
- `pnpm bundle:examples`：需先 build:release，四份 HTML 与资源输出到 site-dist。
- `pnpm preview:examples`：预览构建结果，包括 /minimal-iife.html。
- `pnpm check:release`：覆盖率门禁、未使用声明、公共类型、源清单、文档链接、轻量插件依赖检查、构建、tarball 消费及示例构建。
- 浏览器和流媒体联调见 [本地 fixture](docs/development/fixtures.md)，发布说明见 [SDK 集成](docs/sdk-release-integration.md)。

`pnpm release:candidate` 生成经过完整检查的 tarball、校验和及产物清单，见 [发布流程](docs/sdk-release-integration.md)。

生成物不提交。保留现有有效测试、实验管线、媒体 fixture 和历史验证证据；清理说明见 [本轮复盘](docs/review-2026-10.md)。

## License

[MIT](LICENSE)
