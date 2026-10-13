# 当前质量待办

更新：2026-10-14，1.1.0-rc.1 收口。这是当前待办；逐次执行日志已放入 [历史归档](archive/2026-10-cleanup/docs/commercial-readiness-roadmap.md)。1.0.0 发布快照不能替代当前验证。

产品主线已明确为监控/无人机：多路、低延迟、KLV 同步。分层设计、插件建议与每项验收条件见 [专项推进路线](monitoring-roadmap.md)。

| 优先级 | 尚待验证或完善 | 验收依据 |
| --- | --- | --- |
| P1 | WebRTC TURN relay、受控服务中断恢复及目标设备音频输出 | 固定服务版本、浏览器/OS、输入流、恢复时间及音频证据 |
| P1 | HLS 30 分钟零 fatal 重测、项目专用 HTTP/WS direct fMP4 | 长跑 JSON、断流/恢复记录、资源与帧推进指标 |
| P1 | Safari/Firefox 全协议矩阵 | 各浏览器实测，不能以 Chromium 或 mock 推断 |
| P1 | 实验 WS metadata 出口和视频显示时钟对齐 | 目标 TS、锚点、回绕/重启、seek 和回退 MSE 时行为 |
| P1 | 补齐 Tech 内部时间轴变化和能力契约；实际源/session 基础已提供 | 已覆盖所选备用地址、核心重连与 WS 实验→MSE；继续覆盖协议内部 discontinuity 和设备重启 |
| P1 | 多路预算及启动/冻结观测 | 在目标硬件测 1/4/9/16/32 路，记录资源、首帧/恢复 p95、暂停与后台行为 |
| P2 | File、UI、真实浏览器协议路径的覆盖深化 | 增加有意义的行为场景，避免仅测试实现细节 |
| P1 | 继续迁移 Tech 到已有 signal/逐尝试超时契约 | 中间件、DASH/File/WS MSE loader、WebRTC 信令、direct fMP4 和 GB invite/MSE 已接入；其余实验循环仍需响应取消 |
| P2 | 本地流媒体 fixture 固定服务版本 | CI 或人工复现，配置和镜像版本共同记录 |

已落地：加载代次及串行清理、同 Tech 备用源、受限 storage、通用 MetadataBridge 兼容名称、应用 KLV 集成示例、PTS 精度与私有 PES 分片修复、File/MSE 回归、Vite 示例及包消费者门禁。实际验证结果见 [本轮复盘](review-2026-10.md)。

第二阶段增加插件资源作用域/失败回收、无 UI Blob 截图、显示帧时钟及 KLV 外部时钟注入。它们提供可组合基础；后续已增加应用层四路协调器及本机小分辨率 WebTransport 混合编码验证，仍不代表自动时钟同步或低延迟 SLA。

DRM、字幕、广告、浏览器本地录制没有因此变成已交付能力。后端录制、GB28181 服务端/PTZ 执行继续遵守现有服务边界。当前不新增 KLV 发布包，也不拆除仍在使用的实验管线。
