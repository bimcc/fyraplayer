# FyraPlayer 1.1.0

2026-10-14 准备正式版 1.1.0，此文件定义拟发布范围，不表示已发布到 npm；冻结后只接收阻断发布的修复。准备时 npm latest 为 1.0.2。

## 本次交付

- 播放生命周期：串行切源、同 Tech 备用源、可中止加载/重连的 `stop()`、实际播放会话与时间轴 epoch、加载 signal/超时、插件资源作用域和失败回收。
- 真实断流修复：WebRTC 已请求重连后，不再因已断开 MediaStream 的时间仍在前进而取消重连；画面停止不再被误判为恢复。
- 普通与全景控制：SVG 图标、统一底部控制栏、循环播放、按能力隐藏画质、移动触摸/窄屏菜单/全屏回退、按播放器焦点隔离快捷键，跨域全景切换失败保留普通播放。
- 可选能力：`snapshot`、`frame-clock`、`playback-health`、`gb-gateway` 和实验 `webtransport` 五个新入口；KLV/MISB 解析仍由独立 fyraklv 提供。
- WebTransport：唯一 `fyra-media` 可靠流格式，H.264/条件性 HEVC、可选 raw metadata、原始微秒时钟、有界解码队列、慢首帧保护、取消与显式备用源。
- 应用示例：四路监看、启动/活动预算、焦点优先、离屏/后台释放、返回限流。多路协调器及 fyraklv 组合示例是应用代码，不是 SDK 新导出。

## 从 1.0.2 升级

1. 保留既有公开入口及 KlvBridge 别名；新增插件按需导入。DASH 仍需显式注册，mpegts.js、dashjs、mp4box 仍为可选 peer。
2. `stop()` 释放播放资源但保留 Player 与插件，可再次播放；`destroy()` 后创建新实例。加载/错误/等待重连期间的 `pause()` 会中止加载，正常播放仍为暂停。
3. 自定义 Tech/中间件应响应可选 `AbortSignal`。未适配的 Promise 仍可能延迟最终清理；插件应通过可选 lifecycle 作用域登记清理。
4. 使用实际 `getPlaybackSession()`/`sessionchange` 对齐缓存与时钟；原有 `getCurrentSource()` 表示请求源，不能当作实际备用源。
5. 仅对之前使用未发布 WebTransport 草稿的应用：删除 Source.protocol、解析器版本参数及旧版本类型/常量。记录字节不变，固定格式名称为 `fyra-media`；视频不要求安装 KLV。
6. 画质控件在无能力或只有一个档位时隐藏；普通/全景循环共用 video.loop。多播放器快捷键只作用于获得焦点的容器。

## 支持边界与延期项

- WebTransport 仍为实验视频路径，无音频、A/V 同步、seek、DRM、任意 TS/FLV/MP4 解复用或自动转码；HEVC 配置探测不保证设备实际解码/硬解。
- 已有 Chromium 触摸模拟与本机真实浏览器证据；iOS/Android 真机、Safari/Firefox 对等支持尚未完成。
- 四路 HTTP/3 短测和本机 HLS/WebRTC 验收不等于目标硬件容量、弱网、p95 或全天候运行证明。当前长跑及受控断流的实际结果见候选验收记录；WebRTC TURN 和设备扬声器音频仍需独立验收。
- canvas 绘制帧时钟不等于屏幕呈现时钟；跨摄像机同步、TS 回绕/无感重启及真实遥测同步误差仍需应用与服务端验证。默认/回退 WS MSE 不提供与实验路径相同的 metadata 出口。
- 字幕、DRM、广告、浏览器本地录制和业务 PTZ 执行未纳入本版。根入口与 `/core` 仍为兼容的广泛入口；现有 Vite 大 chunk 提示尚未消除。

## 验收与本地试用

`pnpm release:candidate` 会运行完整发布门禁，生成全新候选目录、npm tarball、SHA-256/SHA-512、工作区指纹与构建日志，并对该 tarball 做 NodeNext/Bundler 类型、公开运行时导入和浏览器打包验证。产物在 `.fyra-releases/`，不自动提交、打 tag、推送或发布。

```sh
npm install /absolute/path/bimccfyra-fyraplayer-1.1.0.tgz
```

本机浏览器附加验收由维护者运行：普通/全景控制、移动模拟、四路、实际 IIFE 包、HTTP/3 与独立 fyraklv。候选 manifest 记录实际执行结果和证据文件；此前日期的结果仍是历史证据。Linux/Windows CI 配置已提供，本机 Windows 运行不能替代远程 CI 通过。

## 后续发布

版本号与包配置已设为 1.1.0 / `latest`。验收和代码审阅完成后，使用已经验收的 tarball 发布，并在两个 Git 远程仓库创建同一提交的 v1.1.0 标签。生成候选包不会改变 npm latest；发布后需从 registry 全新安装复验并核对包完整性。维护者须具备有效 npm 发布身份；RC 的 `next` 规则仍适用于后续预发布版本。
