# 移动端播放与触摸控制

1.1.0-rc.1 候选包含普通皮肤和 PanoramaLite 的移动布局与触摸操作。自动验证采用 Edge/Chromium 的移动视口和触摸事件模拟；iOS Safari、Android Chrome、应用 WebView 的真机播放、音频输出和后台恢复仍需逐设备验证。

## 页面接入

宿主页面设置 viewport，并让播放器容器随页面宽度收缩：

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<div class="player-shell"><video id="video" playsinline></video></div>
<style>
  .player-shell { position: relative; width: 100%; min-width: 0; }
  .player-shell video { display: block; width: 100%; aspect-ratio: 16 / 9; }
</style>
```

`PlayerOptions.playsInline` 默认 `true`，在所有 Tech 加载前配置 video 元素；设为 `false` 可交由浏览器决定是否进入原生视频播放界面。全景视频需要保持行内播放，让视频纹理和 canvas 一起显示。宿主无需禁用页面缩放。

自动播放仍受浏览器策略控制。可使用 `autoplay: true, muted: true` 尝试静音启动，也可等用户点击播放。`play()` 收到浏览器 `NotAllowedError` 后保持当前播放资源，状态转为 paused，发出 `network.code = 'AUTOPLAY_BLOCKED'`；普通 UI 提示点击播放，不触发传输重连。其他启动或协议错误仍走原有错误处理。

## 普通播放器

快捷键按播放器容器焦点路由，输入框、按钮、下拉框及 Shadow DOM 交互元素不触发外层快捷键；多路场景不会一键控制全部窗口。新增 [多路示例](multiview.md) 在窄屏纵向排列，滚动离屏窗口释放连接，返回按启动名额恢复。

- 触摸设备操作按钮至少 44×44 CSS px；进度条保留细线外观，触摸区域高 24px。
- 暂停时点击画面开始播放；播放时点击画面显示或隐藏控制栏，通过播放按钮暂停。播放闲置 3 秒后隐藏，菜单展开或键盘聚焦期间保持可见。
- 容器窄于 520px 时，停止、循环、倍速、截图、画质/播放源及已启用的扩展操作收进“更多”；点选菜单项或画面可收起菜单。菜单高度随播放器调整，内容过多时可滚动。单档位/无画质能力时隐藏画质，直播隐藏循环；横竖屏切换不会恢复空控件。
- 静音按钮保留；触摸设备使用系统音量调节，不显示依赖悬停的音量滑杆。不支持标准画中画 API 时隐藏对应入口。
- 加载或错误提示中的“停止加载”可以直接触摸；停止后可以重新加载地址，无需刷新。SDK `stop()` 保留插件，示例页独立停止按钮则销毁当前 Player。

控制栏考虑 `safe-area-inset-*`，示例页也适配表单换行和 16px 输入字号。安全区实际尺寸、系统键盘、浏览器地址栏变化需要真机复核。

## 全景播放器

单指拖动改变 yaw/pitch，双指捏合改变 fov；捏合不同时旋转画面。现代浏览器使用 Pointer Events，旧环境回退 Touch Events，避免两套事件重复更新视角。取消触摸、失去指针捕获及关闭交互会清理手势状态。

控制栏同样采用底部渐变、SVG 图标和触摸尺寸；播放时闲置自动隐藏，触摸画面唤出。操作进度条或按钮不触发全景拖动。窄屏隐藏 loop，主要操作保持同一排。

## 全屏与横竖屏

普通皮肤和全景共用容器全屏：优先使用标准或 WebKit 容器全屏 API；API 缺失或请求失败时回退到页面内全屏，保留 canvas、控制栏及覆盖层。页面内全屏使用动态视口高度，跟随窗口和横竖屏尺寸变化，不强制锁定方向。

页面内全屏不会隐藏操作系统或浏览器界面。点退出全屏、按 Escape 或销毁播放器会释放页面滚动锁并恢复原有样式。宿主应避免把播放器嵌在带 transform/filter/contain 的祖先中，这些 CSS 可能限制 fixed 定位的页面内全屏；此时应由应用提供合适的顶层播放器容器。

没有调用 iPhone 的原生 video-only 全屏，因为该界面不能保留全景 canvas。嵌入 iframe 时，还需宿主授予相应 fullscreen/autoplay 权限；这些权限和系统策略不能由 SDK 绕过。

## 验证与手机预览

```sh
pnpm build:release
pnpm bundle:examples
node checks/browser-mobile-smoke.mjs
```

runner 使用仓库 MP4 和本地 403 HLS，检查 320/393px 竖屏、844px 横屏、44px 按钮、无横向溢出、真实 CDP touch 输入下的播放/暂停/进度拖动/菜单/错误停止、全景拖动/捏合，以及页面内全屏退出和销毁清理。默认结果与截图写入 `.fyra-long-run/mobile-browser*`；`FYRA_MOBILE_DEMO_URL`、`FYRA_MOBILE_OUTPUT`、`FYRA_MOBILE_CDP_PORT` 可分别指定开发页、证据前缀和独立调试端口。

手机和电脑在同一局域网时，可启动：

```sh
pnpm dev --host 0.0.0.0 --port 5191
```

手机访问 `http://电脑局域网IP:5191/basic.html`，示例地址同样要改成手机可访问的源；手机上的 `127.0.0.1` 指向手机自身。WebRTC、安全上下文和混合内容限制按实际部署配置 HTTPS。桌面本机现有 `127.0.0.1:5190` 预览不直接提供手机访问。

真机验收应覆盖带声音的用户点击播放、静音自动播放、横竖屏/安全区/全屏退出、手势与页面滚动、错误停止再播放，以及锁屏或切后台后的恢复。HLS/MSE/WebRTC、编解码器、CORS、WebGL2 与内存上限各自受设备限制；本轮 UI 模拟结果不扩大 [支持范围](supported-scenarios.md) 的协议承诺。带日期证据见 [验证矩阵](playback-verification-matrix.md)。
