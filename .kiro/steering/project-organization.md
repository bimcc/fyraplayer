# 项目组织架构规范

本文档定义了 FyraPlayer 及相关项目的组织方式和协作模式。

## 核心原则

**独立开发 + 接口文档桥接**

- 各项目保持独立 Kiro workspace
- 通过「API 文档」而非「源码」传递上下文
- Kiro 看「接口」不看「实现」，除非正在开发那个模块

## 项目布局

```
~/projects/
├── fyraplayer/                     # 独立 Kiro workspace - 播放器核心
│   ├── .kiro/
│   │   ├── steering/               # fyraplayer 专属规范
│   │   └── specs/                  # fyraplayer 专属 spec
│   ├── src/
│   ├── docs/
│   │   └── api.md                  # 导出的 API 文档 ⭐
│   └── package.json
│
├── klv/                            # 独立 Kiro workspace - KLV 解析（开源）
│   ├── .kiro/
│   │   └── steering/
│   ├── src/
│   ├── docs/
│   │   └── api.md                  # 导出的 API 文档 ⭐
│   └── package.json
│
└── beeviz/                         # 独立 Kiro workspace - 业务层
    ├── .kiro/
    │   ├── steering/
    │   │   ├── architecture.md
    │   │   └── dependencies.md     # 引用外部依赖的 API 文档
    │   └── specs/
    ├── packages/
    │   ├── core/                   # @beeviz/core - 投影算法
    │   ├── cesium/                 # @beeviz/cesium - Cesium 集成
    │   └── livepano/               # @beeviz/livepano - 全景直播
    ├── apps/
    │   ├── uav/                    # 无人机孪生应用
    │   └── zerocode-components/    # 零代码组件封装
    ├── deps-docs/                  # 依赖项目的 API 文档副本 ⭐
    │   ├── fyraplayer-api.md
    │   └── klv-api.md
    └── package.json
```

## 依赖关系

```
┌─────────────────────────────────────────────────────────────┐
│                    fyrazerocode (零代码平台)                  │
│                         引用组件                             │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                         beeviz                               │
│  @beeviz/cesium │ @beeviz/livepano │ @beeviz/core │ apps/*  │
└─────────────────────────┬───────────────────────────────────┘
                          │ 依赖
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
     ┌──────────┐  ┌──────────┐  ┌──────────┐
     │fyraplayer│  │   klv    │  │  cesium  │
     │ (独立)   │  │ (独立)   │  │ (peer)   │
     └──────────┘  └──────────┘  └──────────┘
```

## 发布策略

| 包名 | 仓库 | 发布方式 | 说明 |
|------|------|----------|------|
| `fyraplayer` | 独立仓库 | npm | 通用播放器，可开源 |
| `@aspect/klv` | 独立仓库 | npm public | KLV 解析，开源 |
| `@beeviz/core` | beeviz monorepo | npm | 投影算法 |
| `@beeviz/cesium` | beeviz monorepo | npm | Cesium 集成 |
| `@beeviz/livepano` | beeviz monorepo | npm | 全景直播 |

## Kiro 开发流程

### 场景 1：开发 fyraplayer

```
打开: fyraplayer/

Kiro 上下文:
- .kiro/steering/architecture.md    # fyraplayer 架构规范
- src/**                            # fyraplayer 源码
- 不包含 beeviz 代码 ✅
```

### 场景 2：开发 beeviz（使用 fyraplayer）

```
打开: beeviz/

Kiro 上下文:
- .kiro/steering/dependencies.md    # 知道依赖哪些外部库
- deps-docs/fyraplayer-api.md       # fyraplayer API（精简）
- deps-docs/klv-api.md              # klv API（精简）
- packages/**                       # beeviz 源码
- 不包含 fyraplayer 源码 ✅
```

### 场景 3：需要跨项目修改

1. 在 beeviz 中发现需要 fyraplayer 新增 API
2. 在 beeviz 中写下需求（spec 或注释）
3. 切换到 fyraplayer workspace
4. 实现新 API，更新 docs/api.md
5. 发布新版本
6. 回到 beeviz，运行 `sync-deps-docs.sh`
7. 继续开发

## API 文档规范

每个独立项目必须维护 `docs/api.md`，包含：

1. **核心类/函数签名**（TypeScript 类型）
2. **事件列表**（名称 + 参数）
3. **使用示例**（最小可用代码）
4. **版本变更**（Breaking Changes）

示例格式：

```markdown
# FyraPlayer API

## 核心类

### FyraPlayer
\`\`\`typescript
class FyraPlayer {
  constructor(options: PlayerOptions)
  play(): Promise<void>
  pause(): void
  destroy(): void
  on(event: string, handler: Function): void
}
\`\`\`

### 事件
- `play` - 开始播放
- `metadata` - 元数据（KLV 原始数据）

## 使用示例
\`\`\`typescript
import { FyraPlayer } from 'fyraplayer';
const player = new FyraPlayer({ container: '#video' });
\`\`\`
```

## 本地联调

当需要本地联调时，使用 pnpm link：

```bash
# fyraplayer 目录
cd ~/projects/fyraplayer
pnpm link --global

# beeviz 目录
cd ~/projects/beeviz
pnpm link fyraplayer --global

# 现在 beeviz 使用本地 fyraplayer
# 但 Kiro 仍然只看 beeviz 代码 + API 文档
```

## 文档同步脚本

在 beeviz 中创建同步脚本：

```bash
# beeviz/scripts/sync-deps-docs.sh
#!/bin/bash

cp ../fyraplayer/docs/api.md ./deps-docs/fyraplayer-api.md
cp ../klv/docs/api.md ./deps-docs/klv-api.md

echo "依赖文档已同步"
```

## 优势

| 方面 | 效果 |
|------|------|
| 上下文长度 | 短，只有当前项目 + API 摘要 |
| steering/spec | 各项目独立，不混乱 |
| Kiro 理解深度 | 聚焦当前项目，依赖只看接口 |
| 稳定模块 | 只读 API 文档，不读源码 |
| 边界清晰 | 跨项目修改需要切换，防止改乱 |
