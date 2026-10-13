# 多路监看与资源调度

2026-10-14，工作区新增的应用层示例，尚未作为独立 SDK API 发布。打开 [multiview.html](../examples/multiview.html)，也可从 basic 页面进入。默认四个窗口，支持文件/MP4、HLS、WebRTC WHEP 和实验 WebTransport；默认静音，源地址由应用提供，WebTransport 使用单一 fyra-media 格式，无版本参数，不自动启用 KLV 或 HEVC 实验开关。

## 所有权与控制

[MultiViewCoordinator](../examples/integrations/multiview.ts) 由页面统一持有，各窗口有独立 Player、video、UI 与 playback-health。协调器不依赖 DOM 或 Player 内部实现，不是安装到每个播放器的插件，不读取其他窗口的帧或修改其时钟。具体 [页面适配](../examples/multiview.ts) 实现 Player 的创建、初始化、播放和销毁。

- 同时播放预算默认 4，同时启动默认 2，支持运行时调整。预算计算包含启动中、已启动和正在释放的实例。
- 运行时降低上限会先释放多余实例；在途启动或清理完成之前，统计可能暂高于新值，此时不增加新实例。
- 优先选中的可见窗口，其余按添加顺序填充。超过预算的窗口排队；没有轮转或自动公平调度，不会周期性打断已播放窗口。
- 页面用 IntersectionObserver 报告窗口相交状态，用 visibilitychange/pagehide/pageshow 报告页面可见性。离屏或后台会销毁实例、关闭连接，返回后按预算重新创建。
- 页面接入等待 Tech ready、play 和已观察到首帧才结束启动阶段；不能只把 init 返回当作开始呈现。health 精度/语义见 [监控插件](monitoring-plugins.md)。
- 启动默认期限 20 秒（通用协调器默认 15 秒）。停止、离屏、移除和销毁立即 abort 并调用资源 destroy，不排在挂起的 start 后面。
- 只有 start 与 destroy 都已结束才归还名额。忽略 signal 或不结束的资源会继续占名额；超时不能代替实际释放。释放失败标记 error 并保留名额，显式 retry 可重新尝试清理，避免未知解码器资源下继续超额启动。
- 页面关闭 Player 的自动重连，将启动/终止错误交给协调器标记并释放。失败不无限循环，用户点“重试”才再次启动。正常播放中的短暂缓冲仍由 Tech 处理；协调器没有另一个重连循环。

“停止全部”与单窗口停止是持久的用户意图，页面重新可见不会重新启动这些窗口。暂停只作用于当前 Player；离屏后实例被销毁，再次创建不会保留暂停位置、播放位置或音量修改，文件从头播放。需要录像续播、后台音频、后台录制的应用应采用不同的可见性策略，不直接照搬本示例。

## 可复用契约

```ts
import { MultiViewCoordinator } from './integrations/multiview.js';

const sessions = new MultiViewCoordinator({ maxActive: 4, maxStarting: 2 });
sessions.add({
  id: 'camera-1', enabled: false,
  create: () => ({
    async start(signal) {
      // 由应用创建/连接媒体资源；逐阶段检查 signal。
      // 等到所需的首帧条件后才 resolve，失败 reject。
      signal.throwIfAborted();
    },
    async destroy() {
      // 幂等释放本次资源；即使 start 正在等待也应开始取消。
    }
  })
});
sessions.setEnabled('camera-1', true);
sessions.focus('camera-1');
sessions.setVisible('camera-1', false);
await sessions.destroy();
```

create 仅同步分配，网络工作放在 start；创建抛错时由工厂回收它在抛错前获取的资源。资源不得在 signal 已取消或 destroy 后再次分配。snapshot 返回简单值的副本，包含预算、占用数、启动数、焦点和每路状态；onChange 失败不影响调度。通用预算参数允许 1..32，只是接口范围，不是 32 路性能承诺。remove 先退役再删除，同 ID 在清理完成前不可复用；destroy 幂等并等待清理，清理失败则拒绝 Promise。

fail(id, error) 只用于终止性失败，不应把每个 waiting 或普通 warning 都作为停流条件。如果应用启用了 Player 自动恢复，需明确错误仲裁和“恢复耗尽”的通知，再决定何时由协调器释放；本示例选择关闭自动重连以确保恢复启动也受集中预算控制。

## 多实例快捷键

普通皮肤的快捷键现在绑定本播放器容器。Tab 聚焦或点击视频区域后，空格、方向键、M/F/P 等只影响该实例；窗口外按键不控制所有视频。输入框、下拉框、按钮、链接、可编辑区和 Shadow DOM 内交互元素保留浏览器键盘行为，不发生按钮与外层快捷键双重切换。组合键、输入法合成和按住重复事件不触发播放器快捷键。

未设置 tabindex 的容器由皮肤临时设为 0，清理时恢复；应用显式设置的 tabindex 保留。此前依赖窗口全局快捷键的应用应把焦点移到目标播放器，或在应用层显式路由快捷键。

## 验证范围

构建后运行 `node checks/browser-multiview-smoke.mjs`。脚本自己创建本地媒体服务器和隔离 Edge，检查四路真实 MP4 帧、启动预算、键盘焦点与 Shadow DOM 按钮、缩减预算与优先窗口、后台/离屏释放、返回限流、坏源隔离、移动滚动与销毁。可用 FYRA_MULTIVIEW_URL 指向运行中的 Vite，FYRA_MULTIVIEW_OUTPUT 指定新证据路径。浏览器检查不是性能压测，状态采样不能取代协调器并发单元测试。

可选设置 FYRA_MULTIVIEW_HLS_DIR 为包含 index.m3u8 与 TS 分片的本地目录，增加真实 HLS ready/首帧和工具栏停止验收。目录仅用于本地测试，不是播放器的运行依赖；生成命令见 [fixture 文档](development/fixtures.md)。

本轮默认 fixture 为同一个 1920×1200 MP4 的四个独立播放器，不是真实四路摄像机；后台部分调用页面使用的同一 setPageVisible 接口，手机滚动部分使用真实 IntersectionObserver。没有 9/16/32 路 CPU/GPU/内存容量、弱网、多路 H.265、真实移动设备、跨路时钟或 KLV 端到端同步证明。主/子码流切换、集中带宽预算和恢复退避策略仍待应用提供。KLV 每路独立使用 fyraklv 与该路时钟，详见 [接入边界](klv-integration.md)。
