# 插件职责与架构判断

当前“Player 编排 + Tech 播放实现 + 显式可选插件”的方向合理。KLV 留在独立 fyraklv，应用持有时间映射与渲染集成；不应把解析器、设备管理或多路布局塞进播放器内核。

本文描述候选版本源码，改动见 [CHANGELOG](../CHANGELOG.md)。详细推进顺序见 [监控/无人机路线](monitoring-roadmap.md)。

## 保持在核心的能力

- Player 生命周期、加载代次、切源、恢复仲裁、Tech 选择及事件一致性。
- 中间件链：request/signal/control/resolve；插件不能自行改写核心内部状态。
- Tech 协议与解码实现、缓存策略及通用 metadata 数据出口。
- 已提供实际所选源/会话 epoch 和协作加载取消契约；更多 Tech 内部 discontinuity、取消适配和统一能力查询仍需补齐，见 [会话契约](playback-sessions.md)。

每个协议的 ABR、重连与低延迟控制应有明确的控制方。新插件不应再启动一个与核心/Tech 竞争的恢复或追帧循环。

## 已有可选能力

公开子路径以 [package.json](../package.json) 为准，下表省略包名前缀 `@bimccfyra/fyraplayer`。

| 能力 | 入口 | 边界 |
| --- | --- | --- |
| UI | `/plugins/ui-components` | 显式启用；业务布局仍由应用管理 |
| DASH | `/plugins/dash` | 注册 Tech，运行时加载 dash.js |
| Engine/source resolver | `/plugins/engines` | 服务器 URL 转换与构造期 resolve 中间件 |
| GB gateway | `/plugins/gb-gateway` | 可选控制面；配对 middleware/plugin，应用注入会话/释放/PTZ，媒体播放交给标准 Tech |
| WebTransport media | `/plugins/webtransport` | 可选独立 Tech；可靠单向视频帧 + WebCodecs，可选原始 private-data/SEI 与原始时钟；首帧验证、取消和显式备用源；实验且无音频 |
| Auth/signing/recovery | `/plugins/auth` | 注入应用 token/签名策略；恢复需与核心网络恢复协调 |
| Preferences | `/plugins/storage` | 可选本地偏好，不承担业务数据持久化 |
| Metrics/performance | `/plugins/metrics`、`/plugins/performance` | 采样、预算和 reporter；不是多路资源调度器 |
| Reconnect 诊断 | `/plugins/reconnect` | 观察重连事件，实际恢复由核心实现 |
| Diagnostics/debug panel | `/plugins/diagnostics` | 快照、事件记录、可选面板 |
| Backend recording | `/plugins/recording-api` | start/stop/status 后端 API；不是浏览器录像或服务端裁剪实现 |
| Screenshot | `/plugins/snapshot` | 新增 Blob 截图与无 UI handle；现有 UI 复用编码逻辑 |
| Displayed-frame clock | `/plugins/frame-clock` | 新增显示帧时间采样及显式 PTS 锚点换算；不自动校时 |
| Playback health | `/plugins/playback-health` | 可选首帧/卡顿/恢复观察、精度标记和 QoS；不控制重连、不推断端到端延迟 |
| Metadata bridge | `/plugins/metadata` | private-data/SEI 通用解析回调；MetadataBridge 保留 KlvBridge 兼容别名 |
| PanoramaLite | `/plugins/panoramalite` | 可选轻量 WebGL2 全景渲染，图片/视频/直播；设备长跑仍需验证 |

第三方 Tech 通过 `PluginContext.techs.register()` 注册并持有 unregister handle。PSV/Cesium 桥接在应用或各自渲染器包中；GB28181 invite/PTZ 是薄网关适配，SIP/RTP/PS、设备权限及执行状态属于后端。

## 本轮加固的插件契约

工厂仍为同步 `(ctx) => void | { destroy() }`；新增可选 `ctx.lifecycle.signal/onCleanup`。Player 始终提供 scope，类型可选是为了兼容自定义宿主。支持初始化失败时回收已注册资源、安装顺序的逆序销毁、并发清理等待与错误隔离。异步任务可在 Player.destroy 开始时响应 abort，不必等最终 Tech 清理。

插件返回的 destroy 先执行，scope cleanup 后执行；同一清理函数重复登记需幂等。生命周期错误通过 PlayerOptions.onPluginError 报告。使用细节和示例见 [监控插件 API](monitoring-plugins.md)。

暂不增加动态 middleware 安装、插件依赖排序、manifest/版本协商或全局服务容器。存在具体消费需求后再添加窄接口；当前数组顺序和显式工厂组合足够。

## 后续插件与应用层能力

| 候选能力 | 决定 |
| --- | --- |
| 启动/卡顿/冻结观测 | playback-health 已实现基础；继续做真实弱网、后台和设备矩阵验证 |
| Live edge/DVR | 等 Tech 能力和实际源契约后实现，尊重协议已有 latency controller |
| KLV 同步适配 | 保持应用层示例；依赖 fyraklv、真实媒体锚点与一致的回绕/重启处理 |
| 多路预算/焦点/批量恢复 | [应用层示例](multiview.md) 已提供实例/启动名额与可见性策略；不是每个 Player 各自控制其他实例的插件；设备容量、码流/带宽预算待验证 |
| ROI/标注/告警、PTZ UI | 按业务需要提供适配器；服务端设备执行与权限外置 |
| 精确帧步进/时间片导出 | 先具备解码、关键帧索引或后端能力，避免仅封装按钮就声称支持 |
| 字幕/DRM/广告/WebXR | 暂缓，保留可选扩展方向 |

主入口和 `/core` 仍广泛导出，不能宣传为最小内核。snapshot/frame-clock/playback-health/metadata 独立入口由 `pnpm check:plugins` 检查，不得引入 UI、Tech、Player 或第三方运行时依赖。测试用 stub 不能替代真实包消费和浏览器验证。
新增 gb-gateway 同样保持轻量；webtransport 的依赖检查允许 AbstractTech，但不允许内建媒体 Tech、Player、UI 或第三方运行时包。两者使用公开扩展契约，不修改核心 Tech 选择逻辑。网关 release 回调期限属于应用责任，WebTransport 只负责视频及通用原始元数据分帧，不等同于完整低延迟监控方案。
