# Implementation Plan: Architecture Refactor

## Overview

按照 `.kiro/steering/architecture.md` 规范重构 FyraPlayer 目录结构。采用渐进式迁移策略，每步完成后验证构建。

## Tasks

- [x] 1. UI 模块迁移
  - [x] 1.1 创建 `src/ui/` 目录并复制文件
    - 复制 `src/plugins/ui/*.ts` 到 `src/ui/`
    - 文件列表: index.ts, shell.ts, controls.ts, fullscreen.ts, events.ts, styles.ts, types.ts
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 1.2 验证 UI 模块构建
    - 运行构建确保无错误
    - _Requirements: 1.4_

- [x] 2. Render 文件重命名
  - [x] 2.1 重命名 panoramaRenderer.ts 为 canvasFrameBuffer.ts
    - 重命名类 `PanoramaRenderer` 为 `CanvasFrameBuffer`
    - _Requirements: 4.1, 4.2_
  - [x] 2.2 更新引用 panoramaRenderer 的文件
    - 更新 `src/integrations/psv/FyraPsvAdapter.ts` 中的导入
    - _Requirements: 4.4_

- [x] 3. Integrations 迁移到 Plugins
  - [x] 3.1 迁移 PSV 适配器
    - 创建 `src/plugins/psv/` 目录
    - 移动 `src/integrations/psv/*.ts` 到 `src/plugins/psv/`
    - 更新内部导入路径（render 引用）
    - _Requirements: 2.1, 2.5_
  - [x] 3.2 迁移 Cesium 适配器
    - 创建 `src/plugins/cesium/` 目录
    - 移动 `src/integrations/cesium/*.ts` 到 `src/plugins/cesium/`
    - _Requirements: 2.2, 2.5_
  - [x] 3.3 迁移 Metadata 桥接
    - 创建 `src/plugins/metadata/` 目录
    - 移动 `src/integrations/metadata/*.ts` 到 `src/plugins/metadata/`
    - _Requirements: 2.3, 2.5_

- [x] 4. Adapters 迁移到 Plugins/Engines
  - [x] 4.1 创建 plugins/engines 目录结构
    - 创建 `src/plugins/engines/` 目录
    - 复制 `src/adapters/engineFactory.ts` 到 `src/plugins/engines/`
    - 复制 `src/adapters/urlConverter.ts` 到 `src/plugins/engines/`
    - _Requirements: 3.1, 3.2_
  - [x] 4.2 迁移 Engine 实现文件
    - 复制 `src/adapters/engines/*.ts` 到 `src/plugins/engines/`
    - 更新所有内部导入路径（从 `../` 改为 `./`）
    - _Requirements: 3.2, 3.3_
  - [x] 4.3 更新 engines/index.ts 导入
    - 更新 EngineFactory 导入路径
    - _Requirements: 3.3_

- [x] 5. 更新主入口和创建插件入口
  - [x] 5.1 创建 plugins/index.ts
    - 导出 PSV, Cesium, metadata, engines 模块
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 5.2 更新 src/index.ts
    - 更新导出路径指向新位置
    - 保持向后兼容的重新导出
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 6. 清理旧目录
  - [x] 6.1 删除旧的 integrations 目录
    - 删除 `src/integrations/` 目录
    - _Requirements: 7.1_
  - [x] 6.2 删除旧的 adapters 目录
    - 删除 `src/adapters/` 目录
    - _Requirements: 7.1_
  - [x] 6.3 删除旧的 plugins/ui 目录
    - 删除 `src/plugins/ui/` 目录
    - 保留 `src/plugins/ui-components.ts`（如果存在且被使用）
    - _Requirements: 7.1_
  - [x] 6.4 删除空的 render/targets 目录
    - 删除 `src/render/targets/` 空目录
    - _Requirements: 7.1_

- [x] 7. 最终验证
  - [x] 7.1 运行构建验证
    - 执行 `npm run build` 确保无错误 ✅
    - _Requirements: 7.2_
  - [x] 7.2 运行测试验证
    - 执行 `npm test` - 106/108 通过
    - 2 个失败测试与架构重构无关（jitterBuffer, demuxer 预存问题）
    - _Requirements: 2.4_

## Notes

- 任务按依赖顺序排列，每步完成后应验证构建
- 迁移采用"复制-验证-删除"策略，确保安全
- 向后兼容通过别名导出和主入口重新导出实现
