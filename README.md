# FyraPlayer

通用低延迟 Web 播放器，支持 WebRTC、LL-HLS/DASH、WebSocket+WebCodecs 等多种播放技术，采用插件/中间件架构设计。

## 特性

- **多播放技术**: WebRTC (OME/WHIP/WHEP)、WS-raw (WebCodecs, FLV/TS)、HLS/DASH、GB28181、本地文件
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

## 核心模块

| 模块 | 说明 |
|------|------|
| `core/eventBus` | 事件发布/订阅，组件间通信 |
| `core/techManager` | Tech 生命周期管理，根据 Source 类型自动选择 Tech |
| `core/pluginManager` | 插件注册、初始化、销毁 |
| `core/middleware` | 请求/响应中间件链 |
| `techs/tech-webrtc` | WebRTC (WHIP/WHEP/Oven-WS) 低延迟播放 |
| `techs/tech-ws-raw` | WebSocket + WebCodecs 低延迟播放 |
| `techs/tech-hlsdash` | HLS/DASH 自适应码率播放（基于 hls.js/dash.js） |
| `techs/tech-gb28181` | 国标 GB28181 流播放 |
| `techs/tech-file` | 本地/远程文件播放（MP4/TS/FLV） |
| `techs/wsRaw/demuxer` | 自研 TS/FLV/AnnexB 解复用器 |
| `render/` | 通用帧渲染抽象 |
| `ui/` | 默认播放器 UI 控件 |

## 外部依赖

| 库 | 用途 |
|----|------|
| `hls.js` | HLS 流播放 |
| `dashjs` | DASH 流播放 |
| `mpegts.js` | TS/FLV 容器解析 + MSE 播放 |
| `mp4box` | MP4 容器解析（WebCodecs 路径） |

## 安装

```bash
pnpm install
pnpm build
```

## 使用

```typescript
import { FyraPlayer } from 'fyraplayer';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'webrtc', url: 'wss://example.com/webrtc' }],
  techOrder: ['webrtc', 'ws-raw', 'hlsdash', 'file'],
  buffer: { targetLatencyMs: 2000 },
  reconnect: { enabled: true },
  autoplay: true,
  muted: true
});

player.on('ready', () => console.log('Player ready'));
player.on('error', (err) => console.error('Error:', err));

await player.init();
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

### 使用场景

| 场景 | 使用组件 | 说明 |
|------|----------|------|
| 播放无人机视频 + KLV | fyraplayer + openklv.KLVParser | 推荐方式 |
| 播放常规视频 | fyraplayer only | 无需 openklv |
| 后台 KLV 提取 | openklv.TSDemuxer | 无需 fyraplayer |

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

### 职责分离

- **FyraPlayer**: 视频播放 + TS 解复用 + 私有数据提取
- **@aspect/openklv**: KLV 语义解析 + 时间同步 + 状态插值

这种分离确保：
1. FyraPlayer 保持通用播放器定位，不绑定 KLV 特定逻辑
2. openklv 可独立使用（后台服务、Node.js 环境）
3. 业务层灵活组合两者

## 相关项目

- [@aspect/openklv](https://github.com/aspect/openklv) - KLV/MISB 元数据解析
- [@beeviz/fyrapano](https://github.com/beeviz/fyrapano) - 全景直播组件
- [beeviz](https://github.com/beeviz/beeviz) - 视频投影业务层

## License

MIT
