# FyraPlayer

通用低延迟 Web 播放器，支持 WebRTC、LL-HLS/DASH、WebSocket+WebCodecs 等多种播放技术，采用插件/中间件架构设计。

## 特性

- **多播放技术**: WebRTC (OME/WHIP/WHEP)、WS-raw (WebCodecs, FLV/TS)、HLS/DASH、fMP4、GB28181、本地文件
- **本地文件播放**: 支持 MP4（原生）、TS/MTS（mpegts.js）、FLV 等格式的本地文件播放
- **高可靠性**: 自动重连、ICE 重启、playoutDelayHint、基于丢包的 ABR 回退、DataChannel 心跳
- **可扩展**: 中间件管线、插件管理器、信令适配器、流媒体服务器 URL 工厂、元数据桥接 (KLV/SEI)
- **可选 UI**: 默认播放控件，可关闭用于嵌入场景
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
│                          ui/                                 │  ← 默认 UI
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
| `gb28181` | tech-gb28181.ts | 国标 GB28181 流播放 | 自研 |
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
| `hls.js` | ^1.4.12 | HLS/LL-HLS 流播放 |
| `dashjs` | ^4.7.4 | DASH 流播放 |
| `mpegts.js` | ^1.7.3 | TS/FLV 容器解析 + MSE 播放 |
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

## 脚本

- `pnpm build` — 构建到 `dist/`
- `pnpm test` — 运行 Jest 测试
- `pnpm dev:vite` — Vite 开发服务器
- `pnpm bundle:examples` — 打包示例

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
