# 完整项目架构目录结构

本文档定义了 FyraPlayer 及相关项目的完整目录结构，作为开发参考。

## 一、整体项目布局

```
~/projects/
├── fyraplayer/                     # 独立仓库 - 通用播放器核心
│   └── (独立 git 仓库)
│
├── klv/                            # 独立仓库 - KLV 解析（开源）
│   └── (独立 git 仓库)
│
├── beeviz/                         # 独立仓库 - 业务层 Monorepo
│   └── (独立 git 仓库)
│
└── fyrazerocode/                   # 独立仓库 - 零代码平台（已有）
    └── (独立 git 仓库)
```

## 二、fyraplayer（独立 npm 仓库）

> 通用低延迟播放器，无业务耦合，可被任意项目引用

```
fyraplayer/
├── .git/
├── .kiro/
│   ├── steering/
│   │   └── architecture.md         # fyraplayer 架构规范
│   └── specs/
│
├── src/
│   ├── core/                       # 核心模块
│   │   ├── eventBus.ts             # 事件总线
│   │   ├── techManager.ts          # Tech 生命周期管理
│   │   ├── pluginManager.ts        # 插件注册与管理
│   │   ├── middleware.ts           # 中间件链
│   │   └── defaults.ts             # 默认配置
│   │
│   ├── techs/                      # 播放技术实现
│   │   ├── tech-webrtc.ts          # WebRTC (WHIP/WHEP)
│   │   ├── tech-ws-raw.ts          # WebSocket + WebCodecs
│   │   ├── tech-hlsdash.ts         # HLS/DASH
│   │   ├── tech-gb28181.ts         # GB28181 国标流
│   │   ├── tech-file.ts            # 本地文件
│   │   │
│   │   ├── webrtc/                 # WebRTC 信令
│   │   │   ├── signalAdapter.ts
│   │   │   ├── signaling.ts        # WHIP/WHEP
│   │   │   └── ovenSignaling.ts    # OvenMediaEngine
│   │   │
│   │   └── wsRaw/                  # WS-Raw 解码管线
│   │       ├── pipeline.ts
│   │       ├── demuxer/
│   │       │   ├── ts-demuxer.ts
│   │       │   ├── flv-demuxer.ts
│   │       │   └── sei.ts          # SEI 数据提取
│   │       ├── webcodecsDecoder.ts
│   │       └── renderer.ts
│   │
│   ├── render/                     # 渲染层
│   │   ├── baseTarget.ts
│   │   └── canvasFrameBuffer.ts
│   │
│   ├── ui/                         # 默认 UI（可关闭）
│   │   ├── index.ts
│   │   ├── shell.ts
│   │   ├── controls.ts
│   │   └── styles.ts
│   │
│   ├── plugins/                    # 可选插件
│   │   ├── psv/                    # PSV 全景
│   │   │   ├── FyraPsvAdapter.ts
│   │   │   └── plugin.ts
│   │   │
│   │   ├── cesium/                 # Cesium 3D
│   │   │   └── FyraCesiumAdapter.ts
│   │   │
│   │   ├── metadata/               # 元数据桥接
│   │   │   └── KlvBridge.ts        # 只转发，不解析
│   │   │
│   │   ├── engines/                # 流媒体服务器适配
│   │   │   ├── engineFactory.ts
│   │   │   ├── urlConverter.ts
│   │   │   ├── ZlmEngine.ts
│   │   │   ├── SrsEngine.ts
│   │   │   ├── MediaMtxEngine.ts
│   │   │   ├── MonibucaEngine.ts
│   │   │   ├── OvenEngine.ts
│   │   │   └── TencentEngine.ts
│   │   │
│   │   ├── metrics.ts
│   │   ├── reconnect.ts
│   │   └── storage.ts
│   │
│   ├── utils/
│   │   └── webcodecs.ts
│   │
│   ├── types.ts
│   ├── player.ts
│   └── index.ts
│
├── docs/
│   └── api.md                      # API 文档（供其他项目引用）⭐
│
├── package.json                    # name: "fyraplayer"
├── tsconfig.json
└── README.md
```

**导出方式：**
```typescript
import { FyraPlayer } from 'fyraplayer';
import { FyraPsvAdapter } from 'fyraplayer/plugins/psv';
import { FyraCesiumAdapter } from 'fyraplayer/plugins/cesium';
import { KlvBridge } from 'fyraplayer/plugins/metadata';
import { EngineFactory } from 'fyraplayer/plugins/engines';
```

## 三、klv（独立 npm 仓库 - 开源）

> KLV/MISB 元数据解析库，零依赖

```
klv/
├── .git/
├── .kiro/
│   └── steering/
│
├── src/
│   ├── parser/
│   │   ├── klvParser.ts            # KLV 通用解析
│   │   ├── berDecoder.ts           # BER 长度解码
│   │   └── checksum.ts             # 校验和
│   │
│   ├── standards/
│   │   ├── misb0601.ts             # MISB ST 0601
│   │   ├── misb0102.ts             # MISB ST 0102
│   │   ├── misb0903.ts             # MISB ST 0903 VMTI
│   │   └── registry.ts
│   │
│   ├── sync/
│   │   └── timeSync.ts             # PTS 时间同步
│   │
│   ├── types.ts
│   └── index.ts
│
├── defs/                           # MISB 标准定义
│   ├── misb0601.json
│   └── misb0903.json
│
├── docs/
│   └── api.md                      # API 文档 ⭐
│
├── package.json                    # name: "@aspect/klv"
├── tsconfig.json
├── LICENSE                         # MIT
└── README.md
```

## 四、beeviz（Monorepo - 业务层）

> 业务能力层 + 应用层，pnpm workspace + turbo

```
beeviz/
├── .git/
├── .kiro/
│   ├── steering/
│   │   ├── architecture.md
│   │   └── dependencies.md         # 外部依赖说明
│   └── specs/
│
├── pnpm-workspace.yaml             # beeviz 内部 workspace（保持不变）
├── turbo.json
├── package.json
│
├── deps-docs/                      # 依赖项目的 API 文档副本 ⭐
│   ├── fyraplayer-api.md           # 从 fyraplayer/docs/api.md 同步
│   └── klv-api.md                  # 从 klv/docs/api.md 同步
│
├── scripts/
│   └── sync-deps-docs.sh           # 同步依赖文档脚本
│
├── packages/                       # 能力层（可独立发布 npm）
│   │
│   ├── core/                       # @beeviz/core - 投影算法
│   │   ├── src/
│   │   │   ├── math/
│   │   │   │   ├── matrix.ts
│   │   │   │   ├── quaternion.ts
│   │   │   │   └── transform.ts
│   │   │   ├── camera/
│   │   │   │   ├── pinhole.ts
│   │   │   │   └── fisheye.ts
│   │   │   ├── projection/
│   │   │   │   ├── homography.ts
│   │   │   │   └── frustum.ts
│   │   │   ├── smoothing/
│   │   │   │   ├── kalman.ts
│   │   │   │   └── interpolation.ts
│   │   │   └── index.ts
│   │   ├── package.json            # 零依赖
│   │   └── README.md
│   │
│   ├── cesium/                     # @beeviz/cesium - Cesium 视频投影
│   │   ├── src/
│   │   │   ├── VideoProjection.ts
│   │   │   ├── PoseController.ts
│   │   │   ├── FrustumVisualizer.ts
│   │   │   ├── TextureManager.ts
│   │   │   └── index.ts
│   │   ├── package.json            # deps: @beeviz/core, peer: cesium
│   │   └── README.md
│   │
│   ├── livepano/                   # @beeviz/livepano - 全景直播
│   │   ├── src/
│   │   │   ├── PsvLivePlugin.ts
│   │   │   ├── LiveStreamController.ts
│   │   │   ├── ViewportTracker.ts
│   │   │   ├── LiveUI.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── package.json            # peer: fyraplayer, @photo-sphere-viewer/*
│   │   └── README.md
│   │
│   ├── arcgis/                     # @beeviz/arcgis - ArcGIS 集成（未来）
│   │   └── ...
│   │
│   └── uav-control/                # @beeviz/uav-control - 无人机控制（未来）
│       └── ...
│
├── apps/                           # 应用层（私有，不发布）
│   │
│   ├── uav/                        # 无人机视频孪生 Demo
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── App.vue
│   │   │   └── components/
│   │   ├── index.html
│   │   ├── package.json            # deps: @beeviz/*, fyraplayer, @aspect/klv
│   │   └── vite.config.ts
│   │
│   ├── livepano-demo/              # 全景直播独立 Demo
│   │   └── ...
│   │
│   └── zerocode-components/        # 零代码组件封装
│       ├── src/
│       │   ├── fyralivePano/
│       │   │   ├── CommonFyraLivePano.vue
│       │   │   ├── FyraLivePanoViewer.vue
│       │   │   ├── config.js
│       │   │   ├── behavior.js
│       │   │   └── lang/
│       │   │
│       │   ├── fyraPlayer/
│       │   │   ├── CommonFyraPlayer.vue
│       │   │   ├── config.js
│       │   │   └── lang/
│       │   │
│       │   ├── uavTwin/
│       │   │   ├── CommonUavTwin.vue
│       │   │   ├── config.js
│       │   │   └── lang/
│       │   │
│       │   ├── videoProjection/
│       │   │   ├── CommonVideoProjection.vue
│       │   │   ├── config.js
│       │   │   └── lang/
│       │   │
│       │   └── index.js
│       │
│       ├── package.json
│       └── README.md
│
└── docs/
    └── README.md
```

## 五、依赖关系图

```
                         ┌──────────────────────┐
                         │    fyrazerocode      │
                         │   (零代码平台)        │
                         └──────────┬───────────┘
                                    │ 引用组件
                                    ▼
┌───────────────────────────────────────────────────────────────┐
│                    beeviz/apps/zerocode-components            │
│  CommonFyraLivePano │ CommonFyraPlayer │ CommonUavTwin │ ...  │
└───────────────────────────────┬───────────────────────────────┘
                                │ 依赖
                                ▼
┌───────────────────────────────────────────────────────────────┐
│                       beeviz/packages                          │
│  @beeviz/livepano │ @beeviz/cesium │ @beeviz/core             │
└───────────────────────────────┬───────────────────────────────┘
                                │ 依赖
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
     ┌──────────┐        ┌──────────┐        ┌──────────┐
     │fyraplayer│        │   klv    │        │  cesium  │
     │ (npm)    │        │ (npm)    │        │ (peer)   │
     └──────────┘        └──────────┘        └──────────┘
```

## 六、发布策略

| 包名 | 仓库 | 发布方式 | 说明 |
|------|------|----------|------|
| `fyraplayer` | 独立仓库 | npm | 通用播放器 |
| `@aspect/klv` | 独立仓库 | npm public | KLV 解析，开源 |
| `@beeviz/core` | beeviz monorepo | npm | 投影算法 |
| `@beeviz/cesium` | beeviz monorepo | npm | Cesium 集成 |
| `@beeviz/livepano` | beeviz monorepo | npm | 全景直播 |
| `@beeviz/uav` | beeviz monorepo | 私有 | 应用 Demo |

## 七、项目间协作方式

### 开发期：pnpm link

```bash
# fyraplayer 目录
cd ~/projects/fyraplayer
pnpm link --global

# klv 目录
cd ~/projects/klv
pnpm link --global

# beeviz 目录
cd ~/projects/beeviz
pnpm link fyraplayer --global
pnpm link @aspect/klv --global
```

### 稳定后：远端 npm

```json
// beeviz/packages/cesium/package.json
{
  "dependencies": {
    "fyraplayer": "^1.0.0",
    "@aspect/klv": "^1.0.0"
  }
}
```

### API 文档同步

```bash
# beeviz/scripts/sync-deps-docs.sh
#!/bin/bash
cp ../fyraplayer/docs/api.md ./deps-docs/fyraplayer-api.md
cp ../klv/docs/api.md ./deps-docs/klv-api.md
echo "依赖文档已同步"
```

## 八、Kiro 开发流程

### 场景 1：开发 fyraplayer

```
打开: ~/projects/fyraplayer/

Kiro 上下文:
- .kiro/steering/architecture.md
- src/**
- 不包含 beeviz 代码 ✅
```

### 场景 2：开发 beeviz

```
打开: ~/projects/beeviz/

Kiro 上下文:
- .kiro/steering/dependencies.md
- deps-docs/fyraplayer-api.md       # API 文档（精简）
- deps-docs/klv-api.md              # API 文档（精简）
- packages/**
- apps/**
- 不包含 fyraplayer 源码 ✅
```

### 场景 3：开发 klv

```
打开: ~/projects/klv/

Kiro 上下文:
- .kiro/steering/
- src/**
- 独立开发，不依赖其他项目 ✅
```

## 九、beeviz 内部 workspace 配置

beeviz 的 `pnpm-workspace.yaml` 保持不变，只管理内部包：

```yaml
# beeviz/pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

**不需要外层统一 workspace**，各项目通过 `pnpm link` 联调。

## 十、核心原则

1. **独立开发**：各项目保持独立 Kiro workspace
2. **API 文档桥接**：通过 `deps-docs/` 传递上下文，而非源码
3. **上下文精简**：Kiro 只看当前项目 + 依赖的 API 摘要
4. **边界清晰**：跨项目修改需要切换 workspace
5. **灵活联调**：开发期用 `pnpm link`，稳定后用远端 npm
