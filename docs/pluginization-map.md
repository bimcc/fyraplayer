# FyraPlayer Pluginization Map

> Created: 2026-05-16  
> Purpose: define what is already pluginized, what should remain core, and what should move to optional plugins later.

This document is the decision map for plugin boundaries. Use it when adding a feature: if the feature is not required for the minimal playback lifecycle, prefer a plugin or adapter.

---

## 1. Boundary Principle

Keep the core small:

- source selection and loading lifecycle;
- Tech registration and active Tech control;
- event bus and stable event payloads;
- middleware execution;
- basic reconnect/fallback coordination;
- minimal stats collection needed by the player itself.

Move out of core:

- UI surfaces and product-specific controls;
- analytics/reporting destinations;
- auth/signing/server URL conversion;
- metadata parsing and business semantics;
- DRM, subtitles, ads, recording, screenshots;
- renderer integrations such as PSV/Cesium;
- vendor-specific stream-server behavior unless exposed through a generic adapter.

Rule of thumb: if a feature can be removed without making basic playback impossible, it should be optional.

---

## 2. Already Pluginized

| Capability | Current Form | Location | Notes |
|---|---|---|---|
| UI controls | `createUiComponentsPlugin()` | `src/ui/shell.ts`, `src/plugins/ui-components.ts` | Explicit plugin entry; `PlayerOptions.ui` is not an active configuration surface |
| Storage | `storagePlugin`, `createStoragePlugin()` | `src/plugins/storage.ts` | Persists last source index with lifecycle cleanup and bounded restore |
| Metrics | `metricsPlugin`, `createMetricsPlugin()` | `src/plugins/metrics.ts` | Reporter-based plugin factory; default export remains console/debug compatible |
| Performance monitor | `createPerformanceMonitorPlugin()` | `src/plugins/performance.ts` | Optional budget/sampling plugin; emits `PERFORMANCE_BUDGET` QoS warnings without changing playback |
| Reconnect logs | `reconnectPlugin`, `createReconnectPlugin()` | `src/plugins/reconnect.ts` | Optional diagnostics callbacks/logging with lifecycle cleanup; not reconnect policy owner |
| Source resolver | `createSourceResolverMiddleware()` | `src/plugins/engines/sourceResolver.ts` | Converts `auto` sources through `EngineFactory` into primary/fallback `Source` objects |
| Metadata parser | `createMetadataPlugin()` | `src/plugins/metadata/KlvBridge.ts` | Optional parser bridge for KLV/SEI/private-data business semantics |
| Third-party Techs | `PluginContext.techs.register()` | `src/types.ts`, `src/player.ts`, `src/core/techManager.ts` | Controlled plugin API for custom Tech registration, replacement, tech-order insertion, and teardown |
| Custom plugins | `PluginCtor` | `src/types.ts` | Supports lifecycle with optional `destroy()` |

---

## 3. Modular But Not Yet Standard Plugins

| Capability | Current Form | Recommended Direction |
|---|---|---|
| KLV/metadata bridge | `KlvBridge` class plus `createMetadataPlugin()` | Keep parsing optional; parser semantics stay outside core |
| Stream server engines | `EngineFactory`, engine classes, `createSourceResolverMiddleware()` | Keep URL conversion optional; middleware is the standard player integration pattern |
| Middleware | `request/signal/control/resolve` entries | Keep as core extension point; provide common plugin factories |
| Tech registration | Built-ins plus `PluginContext.techs.register()` | Keep third-party Techs plugin-owned; use module augmentation for custom `TechName`/`Source` types |
| Render targets | `render/` abstractions plus external PSV/Cesium docs | Keep external renderers as plugins/adapters |
| GB28181 gateway control | Built-in adapter Tech | Keep as thin invite/control adapter; full SIP/RTP/PS server behavior belongs in backend or external gateway packages |

---

## 4. Candidate Plugins

| Plugin | Priority | Status | Why Plugin |
|---|---|---:|---|
| Analytics/Reporter | P1 | partial | Metrics and performance reporter hooks exist; deployment-specific exporters are still external |
| Error UX / Error Codes | P1 | todo | Core should emit structured errors; products decide display/reporting |
| Source Resolver | P1 | done | Engine URL conversion and fallback chains are vendor/project-specific |
| Auth / Signing | P1 | todo | Token, cookie, and URL signing policies are business-specific |
| Playback Preferences | P2 | partial | Volume, mute, speed, source, and quality persistence are optional UX; quality API exists, persistence remains plugin work |
| Metadata Parser | P2 | done | KLV, SEI, ID3, and private data semantics differ by domain; `createMetadataPlugin()` keeps parsing optional |
| Debug Panel | P2 | todo | Useful for development, too heavy/noisy for core |
| Performance Monitor | P2 | done | Sampling/budget rules are optional and product-tunable |
| Screenshot / Recording | P2 | todo | Product feature, not required for playback |
| Render Target Bridge | P2 | todo | PSV/Cesium/canvas integrations should stay optional |
| DRM | P3 | deferred | Requires EME/license/vendor config; not current focus |
| Subtitles/Text Tracks | P3 | deferred | Important later, but should not block playback stabilization |
| Ads / SSAI / CSAI | P3 | deferred | Product/business feature; separate lifecycle and compliance concerns |

---

## 5. Suggested Plugin API Improvements

Current `PluginContext` is useful but narrow. Before adding many plugins, consider:

```ts
interface PluginContext {
  player: PlayerAPI;
  coreBus: EventBusLike;
  techs: TechRegistry;
  storage?: KeyValueStore | null;
  ui?: UISurface;
}
```

Implemented additions:

- controlled `TechRegistry.register()` surface with unregister handles;

Still recommended:

- `registerMiddleware(entry)` for plugin-provided middleware;
- `registerSourceResolver(name, resolver)` for engine/source adapters;
- `logger` or `diagnostics` interface instead of direct `console.*`;
- plugin metadata: `name`, `version`, `capabilities`;
- deterministic plugin teardown order.

Do not expose mutable internal player state directly. Add narrow APIs only when a plugin use case needs them.

---

## 6. Near-Term Actions

| ID | Priority | Task | Acceptance |
|---|---|---|---|
| PL-001 | P1 | done: keep UI as explicit plugin, not `PlayerOptions.ui` | README/API/code agree |
| PL-002 | P1 | done: convert engine URL resolution into a documented resolver middleware pattern | `auto` source examples can use `createSourceResolverMiddleware()` without app-specific glue |
| PL-003 | P1 | done: turn metrics into reporter plugin factory | Consumers can provide endpoint/callback without editing plugin code |
| PL-004 | P2 | done: wrap `KlvBridge` into `createMetadataPlugin()` | Metadata parsing can be enabled with one plugin |
| PL-005 | P2 | done: add controlled third-party Tech registration API | External Techs do not need to patch `FyraPlayer` constructor |
| PL-006 | P3 | Keep DRM and subtitles as plugin placeholders | No core implementation until playback baseline is stable |
| PL-007 | P2 | done: add optional performance budget monitor | Consumers can track FPS/latency/backpressure budgets without core playback coupling |
| PL-008 | P1 | done: add lifecycle-safe storage/reconnect plugin factories | Built-in utility plugins detach listeners on destroy |

---

## 7. Decision Checklist

Before adding a new feature to core, answer:

- Is playback impossible without this feature?
- Does every protocol Tech need it?
- Does it need business-specific configuration?
- Can it be implemented by listening to events or middleware?
- Can it be removed from a bundle without breaking basic playback?

If the answer favors optional behavior, make it a plugin.
