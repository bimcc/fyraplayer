# Requirements Document

## Introduction

基于 `.kiro/steering/architecture.md` 规范，对 FyraPlayer 项目进行架构重构。主要涉及目录结构调整、文件迁移和重命名，以及导入导出关系的更新。目标是使项目结构更清晰，职责分离更明确，同时保持向后兼容性。

## Glossary

- **FyraPlayer**: 核心播放器类，管理播放技术和插件
- **Tech**: 播放技术实现（WebRTC、HLS/DASH、WS-Raw 等）
- **Plugin**: 可选扩展功能（PSV 全景、Cesium 3D、元数据处理等）
- **Engine**: 流媒体服务器适配器（ZLM、SRS、MediaMTX 等）
- **UI_Module**: 播放器默认 UI 控件
- **Render_Layer**: 通用渲染层，帧输出抽象

## Requirements

### Requirement 1: UI 模块提升

**User Story:** As a developer, I want the UI module to be at the top level of src/, so that it's clear UI is a default feature that can be disabled.

#### Acceptance Criteria

1. WHEN the project is built, THE Build_System SHALL include UI from `src/ui/` directory
2. WHEN a developer imports UI components, THE Import_Path SHALL be `./ui/index.js` from src root
3. THE UI_Module SHALL contain all files currently in `src/plugins/ui/`

### Requirement 2: Integrations 迁移到 Plugins

**User Story:** As a developer, I want integrations (PSV, Cesium, metadata) to be in plugins/, so that the architecture clearly shows they are optional extensions.

#### Acceptance Criteria

1. WHEN PSV adapter is needed, THE Import_Path SHALL be from `src/plugins/psv/`
2. WHEN Cesium adapter is needed, THE Import_Path SHALL be from `src/plugins/cesium/`
3. WHEN KLV bridge is needed, THE Import_Path SHALL be from `src/plugins/metadata/`
4. THE Migrated_Files SHALL maintain their original functionality
5. WHEN files are migrated, THE Internal_Imports SHALL be updated to reflect new paths

### Requirement 3: Adapters 迁移到 Plugins/Engines

**User Story:** As a developer, I want engine adapters to be in plugins/engines/, so that URL conversion is clearly an optional feature.

#### Acceptance Criteria

1. WHEN engine factory is needed, THE Import_Path SHALL be from `src/plugins/engines/`
2. THE Engine_Files SHALL include: engineFactory.ts, urlConverter.ts, constants.ts, UrlBuilder.ts, and all engine implementations
3. WHEN engines are migrated, THE EngineFactory_API SHALL remain unchanged
4. THE Migrated_Engines SHALL maintain their original URL conversion logic

### Requirement 4: Render 文件重命名

**User Story:** As a developer, I want panoramaRenderer.ts renamed to canvasFrameBuffer.ts, so that the name accurately reflects its purpose.

#### Acceptance Criteria

1. WHEN the file is renamed, THE New_Name SHALL be `canvasFrameBuffer.ts`
2. WHEN the class is renamed, THE New_Class_Name SHALL be `CanvasFrameBuffer`
3. WHEN imports reference the new name, THE Build_System SHALL resolve correctly

### Requirement 5: 主入口更新

**User Story:** As a developer, I want src/index.ts to reflect the new architecture, so that imports work correctly after migration.

#### Acceptance Criteria

1. WHEN importing from main entry, THE Exports SHALL include core, techs, render, and ui modules
2. THE Main_Entry SHALL NOT export plugins directly (they should be imported separately from plugins/index.ts)
3. THE Export_Structure SHALL follow the pattern defined in architecture.md

### Requirement 6: 插件入口创建

**User Story:** As a developer, I want a plugins/index.ts entry point, so that I can import all optional plugins from one location.

#### Acceptance Criteria

1. WHEN plugins are needed, THE Import_Path SHALL be `fyra/plugins` or `./plugins/index.js`
2. THE Plugins_Entry SHALL export PSV, Cesium, metadata, and engines modules
3. WHEN importing specific plugins, THE Named_Exports SHALL be available

### Requirement 7: 清理旧目录

**User Story:** As a developer, I want old directories removed after migration, so that the codebase doesn't have duplicate files.

#### Acceptance Criteria

1. WHEN migration is complete, THE Old_Directories SHALL be removed: `src/integrations/`, `src/adapters/`
2. WHEN old directories are removed, THE Build_System SHALL not have broken imports
3. IF any external code references old paths, THEN THE Error_Message SHALL indicate the new location

