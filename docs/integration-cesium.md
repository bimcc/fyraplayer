# FyraPlayer + Cesium 集成

FyraPlayer 提供视频元素与通用事件；fyraklv 提供 KLV/MISB 解析和 PTS 查询；Cesium 或应用拥有纹理、地图、投影与场景对象。

| 模块 | 职责 |
| --- | --- |
| FyraPlayer | Source/Tech 播放生命周期、通用 metadata 出口 |
| MetadataBridge / createMetadataPlugin | 调用注入解析器；旧 KlvBridge 名称兼容 |
| 应用 createFyraKlvPlugin 示例 | 连接播放器事件与 KLVStreamManager，管理 reset/destroy |
| fyraklv | KLV/MISB 语义解析、状态缓冲和插值 |
| Cesium/应用桥接 | 纹理与场景生命周期、媒体时间轴锚点、按显示时刻更新姿态 |

此前文档使用的 FyraPlayerCesiumAdapter、VideoSource、UAVVisualizer 是外部项目接口，不是本包导出；请按实际安装的外部项目版本核对名称与参数。本仓库不依赖 Cesium。

## 接入步骤

1. 通过公开 Player API 创建并初始化播放器；把 video 元素交给应用已有的 Cesium 纹理实现，参考 [通用桥接](render-bridges.md)。
2. 若流含 KLV，按 [fyraklv 接入](klv-integration.md) 安装应用层插件；注入新的 KLVStreamManager 并提供已确认的视频秒数到 90 kHz PTS 的映射。
3. 在 Cesium 的渲染循环中调用 handle.getState()，非 null 时再更新姿态。若实验播放路径的 video.currentTime 不可靠，调用 handle.getStateAtPts(displayPts90k)，传入应用确认的显示帧 PTS。
4. 切源时更新时间锚点；插件清空旧 KLV 缓冲。退出时解除 Cesium 渲染回调和纹理绑定，再 await player.destroy()。

不能按 KLV 网络到达时刻直接调用 updatePose 并宣称已经与视频同步。也不能默认首个 KLV PTS 等于视频零点。PTS 回绕、断流重启或 fallback 切换到不同时间轴时需要重新建立锚点。

WS TS 元数据提取需要 pipeline: 'experimental' 和 metadata.privateData.enable；默认/回退 MSE 不产生同等事件。仅安装桥接插件不能增加提取能力。SEI 与 private-data 必须先按事件类型区分再交给对应解析器。

纹理 CORS、源切换、canvas 非空、上下文恢复和长期资源使用需要在具体 Cesium 应用验证，不能由播放器单元测试代替。
