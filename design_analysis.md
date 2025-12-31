# FyraPlayer: 详细分析与设计方案 (V2.2 - 融合 Video.js 分析)

## 1. 竞品播放器深度分析

为了提取 **FyraPlayer** 的最佳实践，我们深入分析了四款目标播放器，并补充是对行业标杆 **Video.js** 的研究。

| 特性 | **Jessibuca** | **Xgplayer** | **OvenPlayer** | **Video.js** |
| :--- | :--- | :--- | :--- | :--- |
| **主要定位** | 低延迟/安防 | 通用 Web 播放器 | 超低延迟 WebRTC | **行业标准框架** |
| **参考价值** | 解码内核 (MSE/WASM) | 插件化架构 | WebRTC/LL-HLS 策略 | **中间件 & Tech 抽象** |

### 1.1 Video.js 深度借鉴分析
Video.js 是 Web 播放器领域的“教科书”，虽然我们不直接使用其代码（因历史包袱较重），但我们汲取其核心设计思想：
*   **Tech (播放技术抽象)**: Video.js 将播放核心抽象为 "Tech" (HTML5, Flash 等)。这与我们设计的 `IDecoder` 异曲同工。我们决定采用类似的 **Tech Order (解码策略)** 机制，即 `decodeStrategy: ['wcs', 'mse', 'wasm']`，按优先级尝试解码器。
*   **Middleware (中间件)**: Video.js 的中间件允许拦截 Player 与 Tech 的通信。我们决定引入 **Loader Middleware (加载中间件)**，允许插件在请求发出前修改 URL 或 Header（用于鉴权、CDN 切换），这是 Video.js 最强大的灵活性来源。
*   **Component 树 vs 插件**：Video.js 使用严格的 UI Component 继承树。我们认为这对于 headless（无头）运行太重，因此维持使用 **Xgplayer 的函数式插件** 架构。

---

## 2. FyraPlayer 增强架构设计

**核心开发原则**: **不重复造轮子 (Don't Reinvent the Wheel)**。我们将深度借鉴并移植成熟播放器的核心代码。

### 2.1 模块移植与复用方案

#### A. WebRTC 核心 (移植自 OvenPlayer)
*   **移植对象**: `OvenPlayer` 的 `WebRTCProvider` 和 `Signaling` 模块。
*   **复用逻辑**: 信令握手、ICE 交换、断线重连。
*   **适配工作**: 编写 `OvenRTCLoader` 适配器。

#### B. LL-HLS 调优策略 (复用自 OvenPlayer)
*   **复用逻辑**: `hls.js` 的低延迟配置参数 (`liveSyncDurationCount` 等)。

#### C. 解码 Worker (借鉴 Jessibuca)
*   **复用思路**: 主线程/Worker 通信协议，RingBuffer 传输 YUV。

#### D. 中间件与插件 (借鉴 Video.js & Xgplayer)
*   **插件系统**: 采用 Xgplayer 的轻量级插件。
*   **中间件**: 采用 Video.js 的中间件链思想处理网络请求。

---

### 2.2 系统架构图 (整合复用层)

```mermaid
graph TD
    User[用户] --> Fyra[FyraPlayer Core]
    
    subgraph "代码复用来源 (Source)"
        OvenSrc[OvenPlayer (WebRTC/HLS)]
        JessSrc[Jessibuca (Wasm Worker)]
        VideoJsSrc[Video.js (Middleware 思想)]
    end

    subgraph "FyraPlayer 内部实现"
        Fyra --> PluginSys[插件系统]
        Fyra --> LoaderMgr[加载器 & 中间件]
        Fyra --> DecoderMgr[解码器]
        
        LoaderMgr -.->|借鉴设计| VideoJsSrc
        LoaderMgr --> RTCLoader[WebRTC Loader]
        RTCLoader -.->|移植逻辑| OvenSrc
        
        DecoderMgr --> WasmWorker[WASM Worker]
        WasmWorker -.->|参考流程| JessSrc
    end
```

---

## 3. 下一步计划

1.  **脚手架搭建**: 已完成。
2.  **核心接口定义**: 已完成初步版本。
3.  **移植验证**: 提取 OvenPlayer 的 WebRTC 信令代码，并在 `RTCLoader` 中实现。

## 4. BeeViz 生态架构规划 (v2.0 - 2025 Roadmap)

*更新于：2025-01-01*

我们已对 `beeviz` 生态及其零代码系统 `rafter-pro` 进行了深入分析，制定了如下架构方案，旨在实现**核心库独立性**与**零代码高度集成**的完美平衡。

### 4.1 总体架构蓝图 (Monorepo)

采用 **Monorepo (pnpm workspace)** 策略，将消费者(Apps)与生产者(Packages)分离。

```text
root/ (beeviz)
├── packages/                      # [Producers] 可独立发布 NPM 包
│   ├── fyraplayer/                # [核心] 通用播放器内核 (WebRTC/HLS/WASM, 无 Vue/React 依赖)
│   ├── livepano/                  # [核心] 全景直播插件 (依赖 fyraplayer + photo-sphere-viewer)
│   ├── klv/                       # [现有] 数据解析库
│   └── fyra-zerocode-adapter/     # [适配] 包含所有零代码组件包装器 (CommonFyraPlayer.vue 等)
│
└── apps/                          # [Consumers] 终端应用
    ├── uav/                       # [现有] 无人机视频孪生 (消费 packages/*)
    ├── livepano-viewer/           # [新增] 独立全景查看器 (轻量级)
    └── rafter-pro/                # [引用] 零代码平台 (通过 NPM 安装 packages/fyra-zerocode-adapter)
```

### 4.2 独立发布策略 (Independent Publishing)

为满足“子项目需在其他项目中独立运行”的需求，所有核心能力均封装在 `packages/` 下：

1.  **`fyraplayer`**:
    *   **发布为**: `npm install fyraplayer` (或 `@beeviz/fyraplayer`)
    *   **用途**: 任何 Web 项目均可使用的低延迟播放器。

2.  **`livepano`**:
    *   **发布为**: `npm install @beeviz/livepano`
    *   **用途**: 提供 `LivePanoPlayer` 类，快速集成全景直播。

3.  **App 独立运行**:
    *   `apps/livepano-viewer` 作为一个极简 Vite 项目，打包出的静态资源可独立部署，通过 URL 参数 (`?url=...`) 独立运行。

---

### 4.3 零代码系统 (Rafter-Pro) 集成方案

经过对 `ref/fyrazerocode` 的分析，我们确定了适配方案。

#### A. 组件规范 (Analysis)
*   **运行时**: Vue 3
*   **数据绑定**: 使用 `BIMCCHooks` (如 `useResolveData`)。
*   **配置定义**: JSON 对象定义 Props (`statusConfig`), Style (`style`), Data Source (`valueOrigin`)。

#### B. 适配层设计 (Adapter Implementation)
我们在 `packages/fyra-zerocode-adapter` 中实现两组文件：

1.  **配置文件 (`config/fyraPlayerConfig.js`)**:
    ```javascript
    export default {
        component: 'CommonFyraPlayer',
        name: 'Fyra 播放器',
        type: 'media',
        statusConfig: {
            streamUrl: '',     // 对应 FyraPlayer.load()
            protocol: 'webrtc' // 对应 Tech 选择
        },
        componentEvents: [
            { type: 'play', label: '播放开始' },
            { type: 'error', label: '播放异常' }
        ]
    }
    ```

2.  **Vue 组件 (`components/CommonFyraPlayer.vue`)**:
    ```javascript
    // 伪代码
    import { FyraPlayer } from 'fyraplayer';
    import { useResolveData } from 'BIMCCHooks';

    const props = defineProps(['item']);
    const streamUrl = useResolveData(props.item.id, 'streamUrl');

    watch(streamUrl, (url) => player.load(url));
    ```

#### C. 数据联动 (Data Flow)
*   **KLV 数据上报**: `CommonFyraPlayer` 内部集成 `@beeviz/klv`，解析出的 GPS/姿态数据通过 `emits("triggerComponentEvent", ...)` 或 `pageEditor.runtime.setData()` 上报给零代码平台，供地图组件消费。

---

### 4.4 结论

该架构不仅支撑了 BeeViz 自身的业务迭代，通过将核心库剥离 UI 逻辑，完美支持了**零代码组件化**。我们将立即着手进行 `packages/fyra-zerocode-adapter` 的脚手架搭建。
