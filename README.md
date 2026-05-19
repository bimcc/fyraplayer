# FyraPlayer

通用低延迟 Web 播放器，支持 WebRTC、LL-HLS/DASH、WebSocket+WebCodecs 等多种播放技术，采用插件/中间件架构设计。

## 1.0 商业基线

FyraPlayer `1.0.0` 定位为可控场景下的商业基线 SDK：核心播放、插件生命周期、公共导出、示例、发布检查和主要浏览器证据已经收口。支持范围以 [支持场景与已知限制](./docs/supported-scenarios.md)、[播放验证矩阵](./docs/playback-verification-matrix.md) 和 [1.0 发布就绪复盘](./docs/release-1.0-readiness.md) 为准。

当前 1.0 不承诺所有浏览器、所有协议、所有后端组合的无条件支持。WebRTC TURN/受控中断恢复、项目专用 direct fMP4、Safari/Firefox 完整矩阵、DRM、字幕、广告/埋点、前端录制、GB28181 服务端栈和 PTZ 设备执行均按文档继续跟进或保持插件/后端边界。

## 特性

- **多播放技术**: WebRTC (OME/WHIP/WHEP)、WS-raw (WebCodecs, FLV/TS)、HLS/DASH、fMP4、GB28181 网关适配、本地文件
- **本地文件播放**: 支持 MP4（原生）、TS/MTS（mpegts.js）、FLV 等格式的本地文件播放
- **高可靠性**: 自动重连、ICE 重启、playoutDelayHint、基于丢包的 ABR 回退、DataChannel 心跳
- **可扩展**: 中间件管线、插件管理器、信令适配器、流媒体服务器 URL 工厂、元数据桥接 (KLV/SEI)
- **可选 UI 插件**: 通过 `createUiComponentsPlugin()` 显式启用，嵌入场景可只使用核心播放器
- **渲染器分离**: PSV 全景、Cesium 3D 地图适配器放在各自独立项目

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        用户应用                              │
├─────────────────────────────────────────────────────────────┤
│  @beeviz/fyrapano    @beeviz/cesium    其他渲染器集成        │  ← 外部项目
├─────────────────────────────────────────────────────────────┤
│  plugins/metadata    plugins/engines                         │  ← 播放相关插件
├─────────────────────────────────────────────────────────────┤
│                          ui/                                 │  ← 可选 UI 插件
├─────────────────────────────────────────────────────────────┤
│                       FyraPlayer                             │  ← 主入口
├─────────────────────────────────────────────────────────────┤
│     core/          techs/           render/                  │  ← 核心层
└─────────────────────────────────────────────────────────────┘
```

## 播放技术 (Tech)

| Tech | 文件 | 用途 | 底层库 |
|------|------|------|--------|
| `webrtc` | tech-webrtc.ts | WebRTC 低延迟播放 (WHIP/WHEP/Oven-WS) | 原生 WebRTC |
| `hls` | tech-hls.ts | HLS/LL-HLS 自适应码率播放 (.m3u8) | hls.js |
| `dash` | tech-dash.ts | DASH 自适应码率播放 (.mpd) | dash.js |
| `fmp4` | tech-fmp4.ts | fMP4 直播流 (无清单，HTTP/WS + MSE) | 原生 MSE |
| `ws-raw` | tech-ws-raw.ts | WebSocket + WebCodecs (FLV/TS) | 自研 + mpegts.js |
| `gb28181` | tech-gb28181.ts | 服务端 GB28181 网关 invite/control + FLV/TS 播放适配 | mpegts.js |
| `file` | tech-file.ts | 本地/远程文件播放 (MP4/TS/FLV) | 原生 + mpegts.js |

## 格式与 Tech 对应关系

| 格式 | 后缀/协议 | 推荐 Tech | 说明 |
|------|-----------|-----------|------|
| HLS | .m3u8 | `hls` | 支持 LL-HLS |
| DASH | .mpd | `dash` | 支持 ABR |
| fMP4 直播 | .m4s, HTTP/WS | `fmp4` | 无清单的 fMP4 流 |
| FLV 直播 | ws://...flv | `ws-raw` | WebSocket FLV |
| HTTP-FLV | http://...flv | `ws-raw` | mpegts.js 播放 |
| TS 直播 | ws://...ts | `ws-raw` | WebSocket TS |
| MP4 文件 | .mp4 | `file` | 浏览器原生 |
| TS 文件 | .ts, .mts | `file` | mpegts.js 播放 |
| WebRTC | wss://, http:// | `webrtc` | WHEP/WHIP/Oven |

## 外部依赖

| 库 | 版本 | 用途 |
|----|------|------|
| `hls.js` | ^1.6.15 | HLS/LL-HLS 流播放 |
| `dashjs` | ^5.1.0 | DASH 流播放 |
| `mpegts.js` | ^1.8.0 | TS/FLV 容器解析 + MSE 播放 |
| `mp4box` | ^0.5.4 | MP4 容器解析（WebCodecs 路径） |

## 安装

```bash
pnpm install
pnpm build
```

## 快速开始

```typescript
import { FyraPlayer } from 'fyraplayer';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/stream.m3u8' }],
  techOrder: ['webrtc', 'ws-raw', 'hls', 'dash', 'fmp4', 'file'],
  autoplay: true,
  muted: true
});

player.on('ready', () => console.log('Player ready'));
player.on('error', (err) => console.error('Error:', err));

await player.init();
```

### 启用 UI 插件

核心播放器不会默认挂载控件；需要 UI 时显式加入插件：

```typescript
import { FyraPlayer } from 'fyraplayer';
import { createUiComponentsPlugin } from 'fyraplayer/plugins/ui-components';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/stream.m3u8' }],
  plugins: [
    createUiComponentsPlugin({
      target: '.player-shell',
      poster: '/poster.jpg'
    })
  ]
});

await player.init();
```

### 插件能力速查

FyraPlayer 的核心只负责播放生命周期、Tech 选择、事件和中间件执行。产品能力通过插件显式启用，推荐从独立子路径导入，避免把不需要的能力打进业务包。

| 插件入口 | 工厂/能力 | 适用场景 |
|---|---|---|
| `fyraplayer/plugins/ui-components` | `createUiComponentsPlugin()` | 播放控制条、质量/源选择、重试、截图入口、录制按钮钩子 |
| `fyraplayer/plugins/diagnostics` | `createDiagnosticsPlugin()`, `createDebugPanelPlugin()` | 当前状态、最近错误/网络/QoS/ICE 线索、诊断导出和调试面板 |
| `fyraplayer/plugins/storage` | `createStoragePlugin()` | 音量、静音、倍速、清晰度、低延迟偏好和上次播放源持久化 |
| `fyraplayer/plugins/auth` | `createAuthSigningMiddleware()`, `createAuthRecoveryPlugin()` | 请求头、凭证、Token、URL 签名和显式 401/403 恢复 |
| `fyraplayer/plugins/recording-api` | `createRecordingApiPlugin()` | 对接后端开始/停止/查询录制；不做浏览器本地录制 |
| `fyraplayer/plugins/performance` | `createPerformanceMonitorPlugin()` | FPS、延迟、pending buffer 等性能预算告警 |
| `fyraplayer/plugins/metrics` | `createMetricsPlugin()` | 业务自定义指标回调或上报适配 |
| `fyraplayer/plugins/reconnect` | `createReconnectPlugin()` | 重连事件日志和产品侧回调；不替代核心重连策略 |
| `fyraplayer/plugins/metadata` | `createMetadataPlugin()`, `KlvBridge` | KLV/SEI/private-data 等元数据业务解析 |
| `fyraplayer/plugins/engines` | `createSourceResolverMiddleware()` | MediaMTX/OME 等服务端播放 URL 到 source/fallback 链的转换 |
| `fyraplayer/plugins/panoramalite` | `createPanoramaLitePlugin()` | 轻量 WebGL2 全景图片、全景视频和全景直播渲染 |

插件应在创建 `FyraPlayer` 时通过 `plugins` 数组安装。产品 UI 可以显示已安装插件并开放安全的运行时模式开关，例如 PanoramaLite 的 `handle.setEnabled()`；当前 SDK 不提供任意热安装插件的公共 API。具体边界见 [插件化边界地图](./docs/pluginization-map.md) 和 [SDK 发布与集成](./docs/sdk-release-integration.md)。

## 使用示例

### HLS 播放

```typescript
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'hls',
    url: 'https://example.com/stream.m3u8',
    lowLatency: true,  // 启用 LL-HLS
    preferTech: 'hls'
  }]
});
```

### DASH 播放

```typescript
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'dash',
    url: 'https://example.com/stream.mpd',
    preferTech: 'dash'
  }]
});
```

### fMP4 直播流（无清单）

```typescript
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'fmp4',
    url: 'https://example.com/live/stream',
    transport: 'http',  // 或 'ws'
    codec: 'h264',
    isLive: true,
    preferTech: 'fmp4'
  }]
});
```

### WebSocket FLV/TS 流

```typescript
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://server/stream.flv',
    codec: 'h264',
    transport: 'flv',  // 或 'ts'
    preferTech: 'ws-raw'
  }]
});
```

`ws-raw` defaults to the stable MSE path (`pipeline: 'mse'`). The in-house
WebCodecs/WASM path is opt-in and should be treated as experimental:

```typescript
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://server/stream.ts',
    codec: 'h264',
    transport: 'ts',
    pipeline: 'experimental',
    preferTech: 'ws-raw'
  }]
});
```

### 本地文件播放

```typescript
// 通过 file input 选择本地文件
const fileInput = document.getElementById('file-input');
fileInput.onchange = async () => {
  const file = fileInput.files[0];
  const blobUrl = URL.createObjectURL(file);
  const ext = file.name.split('.').pop().toLowerCase();
  
  const player = new FyraPlayer({
    video: '#video',
    sources: [{
      type: 'file',
      url: blobUrl,
      // 对于 blob URL，需要指定 container 类型
      container: ext === 'ts' ? 'ts' : (ext === 'mp4' ? 'mp4' : undefined)
    }]
  });
  
  await player.init();
};
```

### 元数据提取 (KLV/SEI)

```typescript
const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://server/stream',
    codec: 'h264',
    transport: 'ts',
    metadata: {
      privateData: { enable: true },
      sei: { enable: true }
    }
  }]
});

player.on('metadata', (evt) => {
  // 传递给 @aspect/openklv 解析
  console.log('Metadata:', evt.type, evt.raw);
});
```

## API 文档

详细 API 文档请参阅 [docs/api.md](./docs/api.md)

## 长期跟进文档

- [商业化成熟度路线图](./docs/commercial-readiness-roadmap.md)：当前商业级差距、优先级、验收门槛和延期插件占位。
- [插件化边界地图](./docs/pluginization-map.md)：已插件化能力、候选插件、核心边界和插件 API 后续方向。
- [渲染桥边界](./docs/render-bridges.md)：PSV/Cesium/map/panorama 适配器的外部化方案和通用视频/画布输出契约。
- [PanoramaLite 计划](./docs/panoramalite.md)：轻量 WebGL2 全景图片、全景视频和全景直播插件专项设计与跟踪。
- [支持场景与已知限制](./docs/supported-scenarios.md)：当前可对外承诺的场景、实验项和明确边界。
- [播放验证矩阵](./docs/playback-verification-matrix.md)：真实浏览器/协议验证范围、样例流、场景和证据记录。
- [性能基线](./docs/performance-baseline.md)：可选性能预算插件、默认阈值和后续 profiling 证据状态。
- [SDK 发布与集成](./docs/sdk-release-integration.md)：ESM、插件子路径、IIFE/CDN 包、发布检查清单和迁移规则。
- [1.0 发布就绪复盘](./docs/release-1.0-readiness.md)：正式 1.0 前的架构、功能、证据、风险和后续任务复盘。
- [代码审查对齐文档](./docs/review-alignment.md)：历史审查结论、已完成整改和复审记录。
- [P0 执行清单](./docs/p0-execution-checklist.md)：第一批正确性修复的执行与验收记录。

## 脚本

- `pnpm build` — 构建到 `dist/`
- `pnpm build:release` — 构建 ESM 包并生成浏览器 IIFE 包
- `pnpm bundle:iife` — 生成 `dist/fyraplayer.iife.js`
- `pnpm check:release` — 运行发布前自检流水线
- `pnpm check:sources` — 校验 `examples/sources.js` 的示例源结构
- `pnpm check:public-api` — 校验 README/API 关键公共用法可通过 TypeScript 编译
- `pnpm check:exports` — 清理并重建 `dist/`，校验 `package.json` exports 指向的文件存在
- `pnpm smoke:panoramalite` — 启动 PanoramaLite 示例并做浏览器 canvas 像素/交互 smoke
- `pnpm test` — 运行 Jest 测试
- `pnpm dev:vite` — Vite 开发服务器
- `pnpm bundle:examples` — 打包示例

## 示例资产

- `examples/basic.html`：主要 ESM 播放器示例和协议测试入口。
- `examples/sources.js`：示例流配置清单，受 `pnpm check:sources` 校验。
- `examples/minimal-iife.html`：无构建环境的 IIFE 集成示例。
- `examples/panoramalite.html`：PanoramaLite WebGL2 全景渲染示例和 smoke 目标。

PSV、Cesium、地图、全景和 KLV 业务解析示例不再放在 `examples/` 里作为可运行占位页面；对应集成边界请看 `docs/render-bridges.md`、`docs/integration-psv.md`、`docs/integration-cesium.md` 和 `docs/klv-integration.md`。

## 与 @aspect/openklv 集成

FyraPlayer 可以与 @aspect/openklv 配合使用，实现无人机视频的 KLV 元数据提取和解析。

### 架构关系

```
┌─────────────────────────────────────────────────────────────────┐
│                         业务应用                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    FyraPlayer                            │   │
│  │  ┌─────────────┐                                        │   │
│  │  │ ts-demuxer  │ ← TS 解复用（视频/音频/私有数据）        │   │
│  │  └──────┬──────┘                                        │   │
│  │         │ onPrivateData(pid, bytes, pts)                │   │
│  └─────────┼───────────────────────────────────────────────┘   │
│            │                                                    │
│            │ 私有数据（可能是 KLV）                              │
│            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   @aspect/openklv                        │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │ KLVParser   │→ │ SyncEngine  │→ │ DroneState  │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 集成示例

```typescript
import { FyraPlayer } from 'fyraplayer';
import { KLVParser, SyncEngine } from '@aspect/openklv';

const parser = new KLVParser();
const syncEngine = new SyncEngine();

const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'ws-raw',
    url: 'wss://server/stream',
    codec: 'h264',
    transport: 'ts',
    metadata: { privateData: { enable: true } }
  }]
});

// FyraPlayer 提取私有数据，openklv 解析 KLV 语义
player.on('metadata', (evt) => {
  if (evt.type === 'private-data') {
    // 检测 KLV Universal Label (06 0E 2B 34)
    if (evt.raw[0] === 0x06 && evt.raw[1] === 0x0E) {
      const frame = parser.parse(evt.raw, BigInt(evt.pts * 90));
      if (frame) syncEngine.push(frame);
    }
  }
});

// 获取同步状态用于投影
function render() {
  const videoPts = BigInt(player.currentTime * 90000);
  const state = syncEngine.getInterpolatedStateAtPts(videoPts);
  if (state) {
    updateProjection(state); // 更新 Cesium 投影
  }
  requestAnimationFrame(render);
}
```

## 相关项目

- [@aspect/openklv](https://github.com/aspect/openklv) - KLV/MISB 元数据解析
- [@beeviz/fyrapano](https://github.com/beeviz/fyrapano) - 全景直播组件
- [beeviz](https://github.com/beeviz/beeviz) - 视频投影业务层

## License

MIT
