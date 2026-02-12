# FyraPlayer P0 第一批执行清单

> 基于：`docs/review-alignment.md`  
> 目标：先修正确性问题，确保后续重构建立在稳定基线之上。  
> 范围：`FP-001` ~ `FP-004`

---

## 0. 执行原则

- 先修“行为正确性”，再做结构优化。
- 每项任务都要求：**改动点明确 + 可验证 + 可回滚**。
- P0 合并策略建议：**小步 PR（每个 FP 独立 PR）**，避免耦合回归。

---

## 1. FP-001：修复 `metadata` 事件透传

## 1.1 目标
- 保证 `player.on('metadata', ...)` 能接收到 tech 层发出的 metadata 事件。

## 1.2 改动文件
- `src/player.ts`

## 1.3 实施点（文件级）
- 在 `attachTechEvents()` 中补齐 `metadata` 事件转发（与 `qos/sei/data/network` 同级）。
- 保持 payload 原样透传，避免破坏现有 `MetadataEvent | MetadataDetectedEvent` 兼容性。

## 1.4 验收标准
- 使用 `ws-raw` 且 metadata 开启时，业务监听器可收到事件。
- 事件结构包含原有字段（如 `type/raw/pts/pid/seiType` 或 detectOnly 结构）。

## 1.5 回归关注
- 不影响现有 `network` 增强逻辑。
- 不影响 `stats` 的包装行为（`{ tech, stats }`）。

---

## 2. FP-002：补齐插件销毁闭环

## 2.1 目标
- `FyraPlayer.destroy()` 时可靠触发插件 `destroy`，避免事件监听和资源泄漏。

## 2.2 改动文件
- `src/player.ts`

## 2.3 实施点（文件级）
- 在 `destroy()` 中接入 `await this.pluginManager.unregisterAll()`。
- 调用时机建议在 `removeAllListeners()` 前完成，确保插件可正常解除监听。
- 保持幂等：重复 `destroy()` 不抛异常。

## 2.4 验收标准
- 插件返回的 `destroy` 可被调用一次且仅一次。
- 销毁后无残留插件事件响应。

## 2.5 回归关注
- 插件销毁异常不应阻断播放器主体销毁（建议捕获并告警）。

---

## 3. FP-003：`failedTechs` 单一事实源

## 3.1 目标
- 消除 `FyraPlayer` 与 `TechManager` 双维护失败状态导致的不一致。

## 3.2 改动文件
- `src/player.ts`
- `src/core/techManager.ts`（如需补充辅助方法/语义注释）

## 3.3 实施点（文件级）
- 将失败状态以 `TechManager` 为唯一维护方。
- `FyraPlayer` 中移除本地 `failedTechs` 读写（或保留但不参与决策，推荐移除）。
- `switchSource()` 改为调用 `techManager.resetFailedTechs()`。
- fatal 网络事件统一通过 `techManager.markTechFailed(currentTech)` 标记。
- `loadCurrent()` 不再做第二套失败过滤（让 `selectAndLoad()` 统一处理）。

## 3.4 验收标准
- 触发一次 tech 失败后，后续选择逻辑行为稳定、可预测。
- 手动切源后失败状态清空，已恢复 tech 可再次参与选择。

## 3.5 回归关注
- 不改变 fallback 触发条件语义。
- 不引入“全部 tech 被永久屏蔽”的僵死状态。

---

## 4. FP-004：应用 request/signal 中间件返回值

## 4.1 目标
- 确保 middleware 改写（`source/url/headers/signal`）真实进入加载链路。

## 4.2 改动文件
- `src/player.ts`

## 4.3 实施点（文件级）
- `loadCurrent()` 中：
  - `request`：使用 `await middleware.run('request', ctx)` 的返回值更新上下文。
  - 基于更新后上下文构建 `patchedSource`。
  - `signal`：同样接收返回值，并将改写继续传递给 `selectAndLoad()`。
- 确保 auto-source resolve 后的 source 不被旧上下文覆盖。

## 4.4 验收标准
- request middleware 改写 URL 后，实际加载使用新 URL。
- signal middleware 对信令配置的改写能传入 tech。

## 4.5 回归关注
- middleware 报错策略保持现状（control 有超时容错，其它按原逻辑）。

---

## 5. 验证清单（每个 FP 合并前）

- `pnpm -s build` 通过。
- 针对改动功能做最小手工验证（建议保留操作记录）。
- 如已补测试：单测针对本 FP 可独立运行通过。

> 说明：当前仓库尚无稳定测试基线，且 jest 受目录噪音影响；P0 阶段以“最小可复现手工验证 + 构建通过”为准，P1 再完善自动化回归。

---

## 6. 建议执行顺序

1. `FP-001`（事件链修复，改动小、收益高）  
2. `FP-002`（生命周期闭环）  
3. `FP-004`（中间件链正确性）  
4. `FP-003`（状态源归一，需稍谨慎）

---

## 7. PR 模板建议（P0）

- 背景问题：
- 改动范围（文件）：
- 行为变化（Before/After）：
- 验证方式（命令 + 手工步骤）：
- 回归风险与回滚方案：

---

## 8. 进度记录

- 2026-02-11：已完成 P0 代码落地（metadata 透传、插件销毁闭环、中间件返回值生效、failedTechs 单一事实源）。
- 2026-02-11：已建立 P1 最小测试基线（`tests/middleware.test.ts`、`tests/techManager.test.ts`）。
- 2026-02-11：已调整 Jest 扫描范围，规避 `ref/` 目录噪音冲突。
- 2026-02-11：新增 `tests/player.test.ts`，覆盖 `metadata` 透传、中间件返回值生效、插件销毁回归。
- 2026-02-11：完成 `FP-008` 第二批类型收敛（`tech-file.ts`、`ui/shell.ts`、`ui/events.ts`），并补齐 `WebCodecsConfig.preferMp4`。
- 2026-02-11：验证通过：`pnpm -s test`（3 suites / 10 tests）与 `pnpm -s build`。
- 2026-02-11：完成 `FP-008` 第三批核心层类型收敛（`core/techManager.ts`、`core/pluginManager.ts`、`core/middleware.ts`），并修复 `PluginCtor` 类型与生命周期实现不一致。
- 2026-02-11：第三批回归通过：`pnpm -s test`（3 suites / 10 tests）与 `pnpm -s build`。
- 2026-02-11：完成 `FP-008` 第四批播放器主链路类型收敛（`player.ts` + `types.ts` + `core/eventBus.ts`），统一事件参数为 `unknown` 模型。
- 2026-02-11：第四批回归通过：`pnpm -s test`（3 suites / 10 tests）与 `pnpm -s build`。
- 2026-02-11：完成 `FP-008` 第五批工具/插件层类型收敛（webcodecs、ui-controls、abstractTech、plugins、engine url builder 等）。
- 2026-02-11：补齐 `PlayerAPI.getSources()/on/once/off` 声明，移除 `storage` 插件对内部私有字段访问。
- 2026-02-11：第五批回归通过：`pnpm -s test`（3 suites / 10 tests）与 `pnpm -s build`。
- 2026-02-11：完成 `FP-008` 第六批（`tech-hls.ts`、`tech-dash.ts`、`tech-fmp4.ts`）事件/统计路径类型收敛。
- 2026-02-11：修正 `dash.js` settings 结构为类型安全写法（`streaming.delay.liveDelay`）。
- 2026-02-11：第六批回归通过：`pnpm -s test`（3 suites / 10 tests）与 `pnpm -s build`。
- 2026-02-11：完成 `FP-008` 第七批（`tech-webrtc.ts`、`webrtc/signalAdapter.ts`、`webrtc/ovenSignaling.ts`）WebRTC 信令/定时器/事件路径类型收敛。
- 2026-02-11：调整 WebRTC 信令网络事件附加字段，避免与原 `type` 字段覆盖冲突（新增 `stage: "webrtc-signal"`）。
- 2026-02-11：第七批回归通过：`pnpm -s test`（3 suites / 10 tests）与 `pnpm -s build`。
- 2026-02-11：完成 `FP-008` 第八批（`tech-gb28181.ts`、`tech-ws-raw.ts`、`wsRaw/pipeline.ts`、`wsRaw/mseFallback.ts`、`wsRaw/renderer.ts`）类型收敛与事件负载收口。
- 2026-02-11：补充低风险收尾（`src/render/canvasFrameBuffer.ts`、`src/types/mp4box.d.ts`）清理剩余 `any`。
- 2026-02-11：第八批回归通过：`pnpm -s test`（3 suites / 10 tests）与 `pnpm -s build`。
