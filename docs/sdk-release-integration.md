# SDK 集成与发布检查

npm SDK 产物位于 dist；Vite 示例站点产物位于 site-dist。它们都是生成物，不提交到 Git。发布文件白名单包含 dist、README、CHANGELOG、LICENSE、RELEASE_NOTES 和 THIRD_PARTY_NOTICES；dist 带随构建复制的第三方授权文件。当前拟发布版本为 1.1.0-rc.1，范围见 [候选说明](../RELEASE_NOTES.md)。

## 公开入口

以 [package.json](../package.json) 的 exports 为准。根入口和 /core 是兼容的广泛入口；可选功能从 plugins 子路径导入。不要引用源码或内部 dist 路径。

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import { createUiComponentsPlugin } from '@bimccfyra/fyraplayer/plugins/ui-components';
import { createDashTechPlugin } from '@bimccfyra/fyraplayer/plugins/dash';
import { MetadataBridge, KlvBridge } from '@bimccfyra/fyraplayer/plugins/metadata';
import { createSnapshotPlugin } from '@bimccfyra/fyraplayer/plugins/snapshot';
import { createFrameClockPlugin } from '@bimccfyra/fyraplayer/plugins/frame-clock';
```

MetadataBridge 和 KlvBridge 是同一类，旧名称保留兼容；destroy 后不再交付异步解析结果。sourcechange 表示切源请求，seek 表示 Player.seek 调用完成，不是原生 video 所有 seeked 事件的替代品。新增 pts90k 为可选字段，旧毫秒 pts 保留。

snapshot/frame-clock 是候选版本的新增子路径，聚合 plugins 与 IIFE 也导出相同能力。类型新增可选 PluginContext.lifecycle 与 PlayerOptions.onPluginError，旧插件工厂仍兼容。行为与限制见 [监控插件 API](monitoring-plugins.md)。

DASH 在 Vite 中应将公开 vendor 子路径以 ?url 导入并传入 scriptUrl，见 [README](../README.md)。MP4Box/mpegts 可由应用 loader 注入。PanoramaLite 属于本包可选插件，PSV/Cesium 适配器和 fyraklv 的应用桥接不作为新 SDK 导出。

## 示例与 IIFE

```sh
pnpm build:release
pnpm dev
pnpm bundle:examples
pnpm preview:examples
```

- multiview.html：应用层四路监看示例，不是 SDK 新入口。
- basic.html：主播放示例，入口 app.ts，由 Vite 处理。
- panoramalite.html：全景交互 smoke 页面。
- minimal-iife.html：独立 script 标签示例，使用 /sdk/fyraplayer.iife.js。Vite 开发服务器从 dist 提供该文件，构建时复制到 site-dist/sdk。
- IIFE 暴露 window.FyraPlayerSDK。宿主可将 dist/fyraplayer.iife.js 部署到自己的静态路径，不需要 Vite。
- minimal-iife.html 可通过 `?file=/example.mp4` 验证自己的本地文件；完整浏览器 smoke 命令见 [fixture](development/fixtures.md)。
- 示例主页面的 DASH vendor 以资源 URL 发布，防止部署后动态脚本地址丢失。
- 示例源地址依赖具体服务；能构建站点不等于这些媒体地址均在线。

## 工程门禁

```sh
pnpm check:release
```

门禁顺序：版本/候选说明/发布标签 → 完整 Jest coverage → noUnused 类型检查 → 源码公共类型契约 → 示例源清单 → 当前文档链接 → 轻量插件依赖 → 发布构建 → 导出文件 → tarball 消费 → 示例构建。CI 配置在 Linux 和 Windows 使用 Node 24，保留 coverage artifact；需以实际远程运行结果判定通过。

`pnpm check:plugins` 对 snapshot、frame-clock、playback-health、gb-gateway、metadata 子路径构建并检查依赖图，不允许引入 UI/Player/Tech 或第三方运行时依赖；输出未压缩字节数用于观察，不代表整个播放器体积。`node checks/browser-package-smoke.mjs` 另行验证 Edge 的 IIFE 视频播放、UI 清理、逐帧时钟、无 UI JPEG 解码尺寸及销毁后 handle 失效，需要本机媒体 fixture。

打包消费者检查执行真实 npm pack，将 tarball 解到临时 node_modules，以 NodeNext 与 Bundler 两种解析方式编译声明（无源码 paths 映射、skipLibCheck=false），导入所有公开 JS 入口并运行浏览器打包。运行依赖来自当前锁文件安装的仓库 node_modules；这不是离线独立安装或所有 peer 组合的证明。生成的临时包只在该检查目录内清理。

覆盖率用于防止已测行为退步；不能替代真实浏览器、音视频输出和长跑验证。浏览器检查需要本机服务和媒体，见 [验证矩阵](playback-verification-matrix.md)。不要把历史结果写成本次通过。

## 生成候选包

```sh
pnpm install --frozen-lockfile
pnpm release:candidate
```

命令每次在 `.fyra-releases/1.1.0-rc.1-随机后缀/` 创建新目录，依次运行完整门禁、打包、最终 tarball 消费检查。失败目录保留日志且 manifest.status=failed。通过时为 package-verified；这只是包验证，浏览器/设备验收状态独立记录。命令不提交、不打 tag、不推送、不发布。

产物包含 npm tgz、SHA256SUMS、npm pack 文件清单/完整性、源码 inventory（包含当前未提交及非忽略新文件）、git HEAD/dirty、锁文件摘要、工具版本和检查日志。构建期间源码变化会使候选失败；后续修改源码应重新生成候选，不覆盖旧文件。工作区指纹标识具体文件内容，不应把 dirty 候选误认为已在远程提交的版本。

## 对最终包做浏览器验收

```powershell
$env:FYRA_SMOKE_PACKAGE='G:/path/to/bimccfyra-fyraplayer-1.1.0-rc.1.tgz'
$env:FYRA_SMOKE_OUTPUT='G:/path/to/candidate/browser-package.json'
node checks/browser-package-smoke.mjs
```

该检查从指定 tarball 提取 IIFE 实际播放，报告包含 tarball SHA-256；页面 HTML 来自 site-dist，媒体来自本机 fixture。未设置 FYRA_SMOKE_PACKAGE 时仅验证 site-dist 构建，不能称为最终包验收。HTTP/3 runner 同样支持 FYRA_SMOKE_PACKAGE。普通/全景、移动、多路及 HTTP/3 检查仍按 [fixture](development/fixtures.md) 运行，保存当次日志并在候选 manifest 明确标为本次或历史证据。相同源码/构建的页面回归与 tarball 消费检查结合，不代表每条协议都做了独立安装测试。

## 维护者发布步骤

1. 审阅代码、候选说明和 manifest，核对最终 tarball 的 SHA256SUMS；CI 状态与目标设备验收由维护者确认。当前本地准备不表示 npm 已发布。
2. RC 发布使用验收过的 tgz 和 `--tag next --access public`；package.json 也默认 next。不要把预发布包推到 latest。
3. 正式 1.1.0 需更新 package.json、CHANGELOG、RELEASE_NOTES、文档版本及 publishConfig.tag=latest，然后重新运行候选生成和验收。
4. 工作区发布设置 prepublishOnly 门禁；直接发布 tgz 不会重跑源码脚本，因此必须使用已验收、未变化的产物。提交/tag/registry 发布由维护者在最终验收后执行。

新 sessionchange/getPlaybackSession 与 loadTimeoutMs/TechLoadOptions.signal 已纳入公开消费检查；尚未响应信号的 Tech 仍可能延迟最终清理，详见 [会话与取消](playback-sessions.md)。
