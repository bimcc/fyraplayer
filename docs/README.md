# FyraPlayer 文档

当前拟发布版本为 **1.1.0-rc.1**；冻结范围、迁移与延期项见 [候选说明](../RELEASE_NOTES.md)，变化见 [CHANGELOG](../CHANGELOG.md)。文档描述当前源码，历史浏览器结果保留原测试日期，不代表本轮重新验证。

| 目的 | 文档 |
| --- | --- |
| 理解模块和依赖方向 | [架构](architecture.md) |
| 实际播放源、时间轴、加载取消 | [播放会话契约与覆盖范围](playback-sessions.md) |
| 选择播放场景 | [支持范围](supported-scenarios.md)、[解码能力](decoder-capabilities.md) |
| 查询配置、事件、插件 | [API](api.md)、[插件职责](pluginization-map.md) |
| 监控/无人机多路与低延迟 | [能力推进路线](monitoring-roadmap.md)、[截图/帧时钟/播放观测/插件生命周期](monitoring-plugins.md) |
| 四路监看、焦点与离屏资源释放 | [应用层多路调度](multiview.md)、[四路页面](../examples/multiview.html) |
| KLV/MISB 与播放器集成 | [fyraklv 接入](klv-integration.md) |
| 轻量全景 | [PanoramaLite](panoramalite.md) |
| 手机、触摸和全屏 | [移动端接入与验证](mobile-playback.md) |
| 外部渲染器 | [通用桥接](render-bridges.md)、[PSV](integration-psv.md)、[Cesium](integration-cesium.md) |
| 流媒体服务器与网关 | [适配器](adapters.md)、[GB28181](gb28181.md) |
| HTTP/3 + WebCodecs + 同流 KLV | [WebTransport 视频/原始元数据与时间契约](webtransport.md)、[应用接入](klv-integration.md) |
| 开发、打包、发布 | [SDK 集成与发布](sdk-release-integration.md)、[本地 fixture](development/fixtures.md) |
| 质量和后续工作 | [本轮复盘与清理](review-2026-10.md)、[验证矩阵](playback-verification-matrix.md)、[性能基线](performance-baseline.md)、[待办](commercial-readiness-roadmap.md) |
| 查询旧设计和执行记录 | [历史归档](archive/2026-10-cleanup/README.md) |

示例源清单只维护在 [examples/sources.js](../examples/sources.js)。它包含本地或外部测试地址，不保证这些服务在线。
