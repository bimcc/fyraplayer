# Design Document: Architecture Refactor

## Overview

本设计文档描述 FyraPlayer 架构重构的详细实现方案。重构目标是将项目结构调整为符合 `.kiro/steering/architecture.md` 规范的形式，同时保持向后兼容性。

## Architecture

重构后的目录结构：

```
src/
├── core/                    # 核心模块（不变）
├── techs/                   # 播放技术（不变）
├── render/                  # 渲染层
│   └── canvasFrameBuffer.ts # 重命名自 panoramaRenderer.ts
├── ui/                      # UI 控件（从 plugins/ui 迁移）
│   ├── index.ts
│   ├── shell.ts
│   ├── controls.ts
│   ├── fullscreen.ts
│   ├── events.ts
│   ├── styles.ts
│   └── types.ts
├── plugins/                 # 可选扩展
│   ├── psv/                 # 从 integrations/psv 迁移
│   ├── cesium/              # 从 integrations/cesium 迁移
│   ├── metadata/            # 从 integrations/metadata 迁移
│   ├── engines/             # 从 adapters 迁移
│   │   ├── engineFactory.ts
│   │   ├── urlConverter.ts
│   │   ├── constants.ts
│   │   ├── UrlBuilder.ts
│   │   ├── ZlmEngine.ts
│   │   ├── SrsEngine.ts
│   │   ├── MediaMtxEngine.ts
│   │   ├── MonibucaEngine.ts
│   │   ├── OvenEngine.ts
│   │   ├── TencentEngine.ts
│   │   └── index.ts
│   ├── metrics.ts           # 保持不变
│   ├── reconnect.ts         # 保持不变
│   ├── storage.ts           # 保持不变
│   └── index.ts             # 新增：插件统一入口
├── utils/                   # 工具函数（不变）
├── types/                   # 类型声明（不变）
├── types.ts                 # 主类型定义（不变）
├── player.ts                # 主类（不变）
└── index.ts                 # 主入口（更新导出）
```

## Components and Interfaces

### 1. UI 模块迁移

迁移路径：`src/plugins/ui/*` → `src/ui/*`

文件列表：
- `index.ts` - 主入口
- `shell.ts` - 播放器外壳
- `controls.ts` - 控件逻辑
- `fullscreen.ts` - 全屏处理
- `events.ts` - 事件绑定
- `styles.ts` - CSS 样式
- `types.ts` - 类型定义

内部导入无需修改（相对路径保持不变）。

### 2. Integrations 迁移到 Plugins

#### PSV 适配器
迁移路径：`src/integrations/psv/*` → `src/plugins/psv/*`

需要更新的导入：
```typescript
// 旧：import { FyraPlayer } from '../../player.js';
// 新：import { FyraPlayer } from '../../player.js'; // 相对路径不变

// 旧：import { PanoramaRenderer } from '../../render/panoramaRenderer.js';
// 新：import { CanvasFrameBuffer } from '../../render/canvasFrameBuffer.js';
```

#### Cesium 适配器
迁移路径：`src/integrations/cesium/*` → `src/plugins/cesium/*`

导入路径保持不变（相对于 src 的层级相同）。

#### Metadata 桥接
迁移路径：`src/integrations/metadata/*` → `src/plugins/metadata/*`

导入路径保持不变。

### 3. Adapters 迁移到 Plugins/Engines

迁移路径：`src/adapters/*` → `src/plugins/engines/*`

需要更新的内部导入：
```typescript
// UrlBuilder.ts
// 旧：import { buildUrl, extractVars, parseUrl } from '../urlConverter.js';
// 新：import { buildUrl, extractVars, parseUrl } from './urlConverter.js';

// 旧：import { EngineUrls } from '../engineFactory.js';
// 新：import { EngineUrls } from './engineFactory.js';

// 各 Engine 文件
// 旧：import { Engine, EngineUrls } from '../engineFactory.js';
// 新：import { Engine, EngineUrls } from './engineFactory.js';

// index.ts
// 旧：import { EngineFactory } from '../engineFactory.js';
// 新：import { EngineFactory } from './engineFactory.js';
```

### 4. Render 文件重命名

重命名：`panoramaRenderer.ts` → `canvasFrameBuffer.ts`

类重命名：`PanoramaRenderer` → `CanvasFrameBuffer`

```typescript
// canvasFrameBuffer.ts
export class CanvasFrameBuffer { ... }
```

### 5. 主入口更新

```typescript
// src/index.ts - 新结构（仅核心模块）
export * from './types.js';
export * from './player.js';
export * from './core/eventBus.js';
export * from './core/middleware.js';
export * from './core/techManager.js';
export * from './core/defaults.js';
export * from './techs/tech-webrtc.js';
export * from './techs/tech-hlsdash.js';
export * from './techs/tech-ws-raw.js';
export * from './techs/tech-gb28181.js';
export * from './techs/tech-file.js';
export * from './utils/webcodecs.js';
export * from './render/canvasFrameBuffer.js';
export * from './ui/index.js';
```

注：插件不在主入口导出，需从 `./plugins/index.js` 单独引入。

### 6. 插件入口

```typescript
// src/plugins/index.ts
export * from './psv/FyraPsvAdapter.js';
export * from './psv/plugin.js';
export * from './cesium/FyraCesiumAdapter.js';
export * from './metadata/KlvBridge.js';
export * from './engines/engineFactory.js';
export * from './engines/index.js';
```

## Data Models

无数据模型变更，仅涉及文件位置和导入路径调整。

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

基于 prework 分析，大多数需求是文件存在性和导入路径的验证，属于示例测试。以下是需要属性测试的核心功能：

### Property 1: Engine URL Conversion Equivalence

*For any* engine type and any valid input URL, the URL conversion result from the migrated engine implementation SHALL be identical to the result from the original implementation.

**Validates: Requirements 3.3, 3.4**

### Property 2: Functional Equivalence After Migration

*For any* existing test case that passes before migration, the same test case SHALL pass after migration without modification (except import paths).

**Validates: Requirements 2.4**

注：由于这是一个重构任务，主要验证方式是：
1. 构建成功（验证导入路径正确）
2. 现有测试通过（验证功能等价）
3. 导出检查（验证 API 兼容性）

## Error Handling

迁移过程中的错误处理：

1. **导入路径错误**: TypeScript 编译器会在构建时报错
2. **缺失导出**: 通过 `src/index.ts` 的重新导出保持向后兼容
3. **类名变更**: 通过别名导出 (`PanoramaRenderer` as alias for `CanvasFrameBuffer`) 保持兼容

## Testing Strategy

### 验证方法

1. **构建验证**: 运行 `npm run build` 确保无编译错误
2. **现有测试**: 运行 `npm test` 确保所有现有测试通过
3. **导入验证**: 创建简单的导入测试验证新旧路径都能工作

### 测试类型

- **单元测试**: 现有测试覆盖功能正确性
- **构建测试**: TypeScript 编译验证导入路径
- **集成测试**: 验证模块间依赖关系正确

### 回归测试

迁移完成后，所有现有测试应无修改通过：
- `tests/eventBus.test.ts`
- `tests/demuxer.test.ts`
- `tests/jitterBuffer.test.ts`
- `tests/ovenSignaling.test.ts`
- `tests/*.property.test.ts`

