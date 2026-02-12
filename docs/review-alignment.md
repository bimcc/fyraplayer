# FyraPlayer 代码审查对齐文档（基线）

> 更新时间：2026-02-11  
> 目的：将“已有审查报告”与仓库现状对齐，形成后续优化工作的统一执行基线。

---

## 1. 对齐结论摘要

综合核查后，原审查报告整体质量较高，结论可用性强，准确度约 **85%~90%**。  
我们建议将其作为后续重构与修复的基础，但需要补充少量高优先级遗漏项（见第 4 节）。

---

## 2. 已核实为“正确/基本正确”的结论

### 2.1 架构与入口
- `src/core.ts` 与 `src/index.ts` 导出高度重叠，`core` 的“最小包”定位与实际不一致。
- `package.json` 未导出 `./core`，`fyraplayer/core` 无法按包子路径使用。

### 2.2 类型与实现一致性
- `PluginCtor` 类型定义为仅返回 `void`，但运行时支持返回带 `destroy` 的对象（类型与行为不一致）。
- `PlayerOptions.ui` 存在于类型，但 `FyraPlayer` 构造流程未直接消费该配置。

### 2.3 状态管理与失败回退
- `failedTechs` 在 `FyraPlayer` 与 `TechManager` 双处维护，存在状态不同步风险。

### 2.4 测试与可维护性
- Jest 配置存在，但没有 `tests/` 用例。
- `pipeline.ts` 超大文件（~1000+ 行）承担过多职责，拆分需求成立。
- 代码中存在占位注释（`????????`）与较多 `any` 使用。

### 2.5 性能与运行时行为
- `Renderer` 在 `VideoFrame` 路径下虽然初始化了 WebGL，但实际仍走 `Canvas2D drawImage` 回退路径。
- `fMP4` 的 `pendingBuffers` 队列缺少明确的背压上限控制。
- `WebRTCTech.getStats()` 采用“同步返回缓存 + 异步刷新”模式，首次/早期调用语义不直观。

---

## 3. 需要微调表述的点

- 原报告写到 `pipeline.ts` “1044 行”，当前仓库约为 **1043 行**（语义不变，仅行数轻微差异）。
- `core.ts` 不是“编译意义上的死代码”（会产出到 `dist/core.js`），但在 `exports` 下不可通过包子路径访问，实际对外不可用，等价于“发布层面不可达”。

---

## 4. 原报告遗漏但应纳入 P0 的问题

### 4.1 `metadata` 事件未贯通到 Player 层（P0）
- Tech 层（如 ws-raw）会发 `metadata`，但 `player.ts` 的 `attachTechEvents()` 未转发该事件。
- 结果：业务侧 `player.on('metadata', ...)` 可能无法收到预期事件。

### 4.2 插件生命周期未完整闭环（P0）
- `PluginManager` 支持 `unregisterAll()` 与 `destroy` 回收，
- 但 `FyraPlayer.destroy()` 未调用插件统一清理，存在资源泄漏风险。

### 4.3 request/signal 中间件返回值未被采纳（P0）
- `MiddlewareManager.run()` 返回合并后的上下文，
- 但 `loadCurrent()` 对 `request/signal` 的调用未接收返回值，导致中间件改写可能失效。

### 4.4 文档与导出路径漂移（P1）
- 部分文档仍引用旧路径/旧描述（例如 `src/adapters/...`、root re-export 假设等）。
- 示例存在直接引用 `src/...` 的情况，不利于包使用场景。

---

## 5. 统一优先级路线图（执行顺序）

## P0（先做，保障正确性）
1. 修复 `metadata` 事件转发链路。  
2. 在 `FyraPlayer.destroy()` 接入插件统一回收。  
3. 收敛 `failedTechs` 为单一事实源（建议保留在 `TechManager` 或统一封装访问）。  
4. 修复 `request/signal` 中间件返回值未应用问题。  

## P1（稳定性与可回归能力）
1. 建立最小测试基线：`TechManager` 选择/回退、middleware 链、demux 基础路径、codec string 推导。  
2. 处理当前 Jest 运行噪音（含 haste collision）并固化测试入口。  
3. 对高风险模块补充回归测试（WebRTC stats、ws-raw metadata detectOnly）。

## P2（结构与性能优化）
1. 拆分 `wsRaw/pipeline.ts`（传输/解复用/视频解码/音频解码/GB28181 framing/catch-up 策略）。  
2. 收敛 `any`，优先处理 `tech-webrtc.ts`、`player.ts` 事件转发、`tech-file.ts`。  
3. 文档与导出清理：`core` 子路径、UI 使用方式、engines/adapters 文档一致性。  

---

## 6. 任务拆解（可直接建 issue）

| ID | 优先级 | 任务 | 交付物 | 验收标准 |
|---|---|---|---|---|
| FP-001 | P0 | 修复 metadata 事件透传 | `player.ts` 事件映射修复 | `player.on('metadata')` 可收到 ws-raw/file metadata |
| FP-002 | P0 | 插件销毁闭环 | `destroy()` 调用插件清理 | 插件 `destroy` 被稳定调用，无残留监听器 |
| FP-003 | P0 | failedTechs 单一事实源 | 状态归一化实现 | 源切换/重连后无“已恢复 tech 仍被屏蔽” |
| FP-004 | P0 | 中间件返回值应用 | `loadCurrent()` 修复 | request/signal 对 source/url 改写可生效 |
| FP-005 | P1 | 测试基线搭建 | `tests/` + 最小用例集 | CI/本地可稳定跑通基本用例 |
| FP-006 | P1 | Jest 环境整治 | 配置与忽略规则 | 无无关 collision，测试结果可重复 |
| FP-007 | P2 | pipeline 拆分重构 | 多模块拆分 PR | 行为等价，关键回归通过 |
| FP-008 | P2 | any 收敛 | 类型改进 PR | 关键路径 any 明显下降 |
| FP-009 | P2 | 文档/导出一致性修复 | README/docs/package 对齐 | 文档示例可按包路径执行 |

---

## 7. 验收口径（团队统一）

### 7.1 功能正确性
- 以事件链路、回退链路、插件生命周期作为 P0 首要验收口径。

### 7.2 可回归性
- 每个 P0/P1 任务至少有 1 条自动化测试或可重复的手工验证脚本。

### 7.3 文档一致性
- 文档示例必须可执行，导出路径必须与 `package.json` `exports` 一致。

---

## 8. 推荐推进方式

建议按以下节奏推进：
- 第 1 周：完成 P0（优先事件/中间件/生命周期）。
- 第 2 周：完成 P1（最小测试基线 + Jest 稳定）。
- 第 3~4 周：推进 P2（拆分与类型治理，按模块分批合入）。

---

## 9. 备注

- 本文档定位为“工作基线”，不是最终技术设计文档。  
- 每完成一个任务，建议在对应 Issue/PR 中回填：变更点、验证方式、风险回归项。  

---

## 10. 当前完成状态（进度）

### 10.1 已完成（P0）
- `FP-001`：已修复 `metadata` 事件透传。
- `FP-002`：已接入插件销毁闭环（`FyraPlayer.destroy()` 调用插件清理）。
- `FP-003`：已完成 `failedTechs` 单一事实源收敛（统一由 `TechManager` 维护）。
- `FP-004`：已修复 `request/signal` 中间件返回值未应用问题。

### 10.2 已完成（P1 基线）
- `FP-005`：已建立最小测试基线：
  - `tests/middleware.test.ts`
  - `tests/techManager.test.ts`
  - `tests/player.test.ts`
- `FP-006`：已完成 Jest 范围收敛与目录噪音规避（`ref/`、`dist/`）。

### 10.3 进行中
- `FP-009`：文档/导出一致性修复已开始（入口导出与 docs 路径正在对齐）。
- `FP-008`：类型收敛第一批已推进（`player.ts` 网络事件类型收敛、`tech-webrtc.ts` stats/playlist 关键路径 any 显著减少）。

### 10.4 最新进展（2026-02-11）
- `FP-008` 第二批已完成：`src/techs/tech-file.ts` 的 MP4Box/WebCodecs 路径完成类型收敛，移除了该文件内 `any`。
- `FP-008` 第二批已完成：`src/ui/shell.ts` 与 `src/ui/events.ts` 的事件 payload 与 bus handler 完成 `unknown`/显式类型收敛。
- 配套类型补齐：`src/types.ts` 为 `WebCodecsConfig` 增加 `preferMp4?: boolean`，与 `tech-file` 现有行为对齐。
- 验证结果：`pnpm -s test`（3 suites / 10 tests）通过，`pnpm -s build` 通过。
- `FP-009` 持续推进：完成 `hlsdash` 残留引用对齐（`docs/integration-psv.md`、`docs/integration-cesium.md`、`examples/cesium-video.html`、`examples/panorama-psv.html`）。
- `FP-008` 第三批已完成（核心层）：`src/core/techManager.ts`、`src/core/pluginManager.ts`、`src/core/middleware.ts` 完成一轮 `any` 收敛与错误类型化。
- 类型一致性修复：`src/types.ts` 中 `PluginCtor` 与插件实际生命周期行为对齐（支持返回 `destroy`）。
- 第三批验证结果：`pnpm -s test`（3 suites / 10 tests）通过，`pnpm -s build` 通过。
- `FP-008` 第四批已完成（播放器主链路）：`src/player.ts` 事件处理与 `control` 入参返回类型完成 `unknown` 化，`attachTechEvents` 的转发参数处理做了类型安全收敛。
- 配套类型同步：`src/types.ts`（`PlayerAPI` / `EventBusLike` / `Tech`）与 `src/core/eventBus.ts` 已统一为 `unknown` 事件参数模型。
- 第四批验证结果：`pnpm -s test`（3 suites / 10 tests）通过，`pnpm -s build` 通过。
- `FP-008` 第五批已完成（工具与插件层）：`src/utils/webcodecs.ts`、`src/ui/controls.ts`、`src/techs/abstractTech.ts`、`src/plugins/{metrics,reconnect,storage}.ts`、`src/plugins/engines/*`、`src/utils/formatDetector.ts`、`src/techs/wsRaw/webcodecsDecoder.ts` 完成低风险 `any` 收敛。
- API 一致性增强：`PlayerAPI` 新增 `getSources()` 及 `on/once/off` 声明，消除 `storage` 插件对内部私有字段的访问。
- 第五批验证结果：`pnpm -s test`（3 suites / 10 tests）通过，`pnpm -s build` 通过。
- `FP-008` 第六批已完成（中等风险 Tech 层）：`src/techs/tech-hls.ts`、`src/techs/tech-dash.ts`、`src/techs/tech-fmp4.ts` 的事件回调与统计路径 `any` 收敛完成。
- 兼容性修正：`dash.js` 设置项改为类型安全结构（`streaming.delay.liveDelay`），去除无效字段写入。
- 第六批验证结果：`pnpm -s test`（3 suites / 10 tests）通过，`pnpm -s build` 通过。
- `FP-008` 第七批已完成（WebRTC 链路）：`src/techs/tech-webrtc.ts` 定时器/统计缓存/播放提示相关 `any` 收敛，`signalAdapter.ts` 与 `ovenSignaling.ts` 的事件与信令消息类型完成显式化。
- WebRTC 联动修正：信令侧事件上报保留原语义并避免字段覆盖（`network` 事件改用 `stage: "webrtc-signal"` 附加上下文）。
- 第七批验证结果：`pnpm -s test`（3 suites / 10 tests）通过，`pnpm -s build` 通过。
## 11. Progress Update (2026-02-11)

- `FP-008` batch 8 completed for GB28181 + WS-Raw typing cleanup.
- Updated `src/techs/tech-gb28181.ts` to resolve invite/control payload and streamInfo typing mismatches.
- Updated `src/techs/tech-ws-raw.ts` fallback trigger guard to narrow `evt.errors` safely.
- Updated `src/techs/wsRaw/{mseFallback.ts,renderer.ts,pipeline.ts}` for stricter `unknown`/event payload handling.
- Follow-up cleanup completed in this round: `src/render/canvasFrameBuffer.ts`, `src/types/mp4box.d.ts`.
- Validation: `pnpm -s test` (3 suites / 10 tests) passed; `pnpm -s build` passed.

## 12. FP-007 Pipeline Split (Phase 1)

- Scope: keep behavior-equivalent split with low regression risk.
- Extracted from `src/techs/wsRaw/pipeline.ts`:
  - `src/techs/wsRaw/url.ts` (WebSocket URL validation)
  - `src/techs/wsRaw/catchup.ts` (catch-up policy engine)
  - `src/techs/wsRaw/gbUtils.ts` (GB stream-info parsing/base64 helpers)
  - `src/techs/wsRaw/metadata.ts` (metadata demux options + sorted flush)
- `pipeline.ts` now orchestrates modules rather than embedding all helper logic.
- Regression status: behavior kept equivalent for existing test/build baseline.
- Validation: `pnpm -s build` passed; `pnpm -s test` (3 suites / 10 tests) passed.

## 13. FP-007 Pipeline Split (Phase 2)

- Scope: split audio rendering/output responsibilities from pipeline orchestration.
- Added `src/techs/wsRaw/audioOutput.ts`:
  - `PcmAudioOutput` encapsulates `AudioContext` lifecycle, PCM buffer playback, AudioWorklet sink, and G.711 decode/playback path.
- Updated `src/techs/wsRaw/pipeline.ts`:
  - delegates audio output/G.711 playback to `PcmAudioOutput`
  - removes inlined PCM/worklet/G711 utility methods
  - keeps decode/fallback control flow behavior equivalent
- Size reduction:
  - `pipeline.ts` reduced to 683 lines (from ~1000+ baseline).
- Validation:
  - `pnpm -s build` passed
  - `pnpm -s test` (3 suites / 10 tests) passed

## 14. GB28181 Integration Compatibility Update (2026-02-11)

- `src/types.ts`: `Gb28181Source` now supports optional `responseMapping` for invite response extraction (dot-path supported).
- `src/techs/tech-gb28181.ts`:
  - invite response parsing now supports mapping + defaults (`url/wsUrl`, `callId/dialogId`, `streamInfo`, `stream_id/streamId`).
  - control payload for `gb:bye` / `gb:ptz` now includes full GB context (`deviceId`, `channelId`, `callId`, `ssrc`, `streamId`) while keeping caller override ability.
- Validation:
  - `pnpm -s build` passed
  - `pnpm -s test` passed (3 suites / 10 tests)
