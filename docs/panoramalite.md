# PanoramaLite

包内可选的轻量等距柱状全景插件，支持视频与图片、拖拽/缩放、yaw/pitch/roll/fov 和可选 viewer controls。复杂 PSV、Cesium 和地图投影仍由外部应用接入。

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import { createPanoramaLitePlugin } from '@bimccfyra/fyraplayer/plugins/panoramalite';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'file', url: '/panorama.mp4' }],
  plugins: [createPanoramaLitePlugin({
    target: '#panorama',
    media: 'video',
    enabled: true,
    interactive: true,
    initialView: { yaw: 0, pitch: 0, roll: 0, fov: 75 },
    onReady: handle => { handle.setView({ yaw: 20 }); }
  })]
});
await player.init();
```

图片模式设置 `media: 'image', image: '/panorama.jpg'`，无需为了图片调用播放初始化；仍需在退出时销毁 Player。图片和视频纹理受浏览器 CORS 限制。

| Handle API | 行为 |
| --- | --- |
| setEnabled / isEnabled | 切换全景输出 |
| setView / getView / resetView | 管理视角，角度以度表示 |
| bindVideo | 绑定视频元素 |
| setImage | 异步设置图片 |
| setInteractive | 开关交互 |
| resize | 按容器重新计算大小 |
| destroy | 移除 canvas、监听和渲染资源；Player 销毁也会清理插件 |

`viewerControls` 可配置播放、seek、loop、音量、全屏和 resetView。`textureFlipX/Y` 默认 false，不按“全景源”自动翻转。图片方向以原素材验证，roll 是独立轴，不以 yaw/pitch 推导。

普通视频能否进入全景不由 KLV 或 WebTransport 版本决定。全景是将已解码画面上传为 WebGL 纹理；跨域 URL 能原生播放，并不代表允许读取像素。应在加载前设置 video.crossOrigin，并由服务器提供匹配的 CORS 响应。HLS.js 通过 CORS fetch/MSE 加载，与未设置 crossorigin 的原生 MP4 路径不同；不能只凭两个 URL 的结果判断 H.264/H.265 支持。

basic 示例在已加载的跨域原生视频切换全景时，先做带 Range 的 CORS GET 并取消响应体。允许读取后设置 anonymous 并重载，恢复有限时长视频的位置、播放和循环状态；检查失败保留普通播放器并显示原因，停止可取消检查。网络、鉴权或 Range 规则也可能使检查失败，需要检查实际响应；跨域重定向最终响应同样需要许可。插件本身不探测/重载 URL，纹理上传失败会停止渲染循环、恢复原视频并调用 onError。普通/全景循环均使用 video.loop。

普通平面视频即使成功开启全景，也只是被映射到球面，不会生成真实 360° 内容；素材应为等距柱状投影。没有 KLV 插件不会影响全景渲染。

1.1.0的控制栏与普通皮肤一致：贴底渐变背景、顶部细进度条、下方一排白色 SVG 图标，音量滑杆在悬停或键盘聚焦时展开。播放时闲置 3 秒自动隐藏，移动指针、触摸或聚焦后恢复；暂停时保持可见。窄容器隐藏 loop，直播隐藏 seek/loop 并显示 LIVE。所有播放按钮调用 PlayerAPI，保留中间件和统一播放状态；不依赖字体或字符图标。工具栏事件不会触发全景拖动。

控制栏与错误地址停止的确定性浏览器回归：构建后运行 `node checks/browser-controls-smoke.mjs`，默认使用本地 MP4、403 HLS 和挂起 HTTP endpoint；`FYRA_CONTROLS_DEMO_URL` 可指定开发页。结果与宽/窄屏截图写入 `.fyra-long-run/controls-browser*`。这是 Edge 功能 smoke，不代表全协议或移动端兼容性验证。

性能限制通过 `maxPixelRatio`、`maxCanvasPixels`、`maxVideoFps` 显式配置；默认不隐含降低画质的上限。浏览器能力、视频解码和高分辨率纹理决定实际表现。公开类型见 [API](api.md)，交互示例为 [panoramalite.html](../examples/panoramalite.html) 和 [basic.html](../examples/basic.html)。

移动端使用 44px 操作按钮和 24px 进度触摸区域；单指拖动、双指缩放使用互斥的 Pointer/Touch 事件路径，避免重复更新。全屏优先保留整个播放器容器，不支持时回退页面内全屏。详细行为、手机访问方式和真机验证边界见 [移动端播放](mobile-playback.md)。

```sh
pnpm dev
pnpm smoke:panoramalite --scenario image --duration 3s --out .fyra-long-run/panoramalite-image --fail-on-error
```

smoke 检查非空画布、交互像素变化、roll 稳定及销毁清理；需要本机兼容浏览器。它不证明全部视频协议、GPU 或移动浏览器受支持。历史实现与复测记录见 [归档](archive/2026-10-cleanup/docs/panoramalite.md)。
