# FyraPlayer 架构规范入口

当前规范维护在 [docs/architecture.md](../../docs/architecture.md)，公共契约见 [docs/api.md](../../docs/api.md)。

- 包名是 `@bimccfyra/fyraplayer`；UI 和 DASH 通过插件显式启用。
- PanoramaLite 是包内可选全景插件；PSV/Cesium 具体适配由外部应用或渲染器包管理。
- KLV/MISB 解析、同步与离线提取由独立 `fyraklv` 项目负责。
- 播放器只负责通用 metadata 出口和注入式 MetadataBridge，旧 KlvBridge 名称保留兼容。
- `core` 是兼容的广泛公开导出，不是已经完成物理拆分的最小内核。
- 历史需求和执行记录在 [归档](../../docs/archive/2026-10-cleanup/README.md)，不应再次作为待实施任务。
