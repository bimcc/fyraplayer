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
- DRM, subtitles, ads, browser-side recording, screenshots;
- renderer integrations such as PSV/Cesium;
- vendor-specific stream-server behavior unless exposed through a generic adapter.

Rule of thumb: if a feature can be removed without making basic playback impossible, it should be optional.

---

## 2. Already Pluginized

| Capability | Current Form | Location | Notes |
|---|---|---|---|
| UI controls | `createUiComponentsPlugin()` | `src/ui/shell.ts`, `src/plugins/ui-components.ts` | Explicit plugin entry with quality/source controls, interruption status layer, retry button, preference events, diagnostics entry, screenshot feedback, and recording toggle hook |
| Storage/preferences | `createStoragePlugin()` | `src/plugins/storage.ts` | Persists last source index plus opt-in volume, mute, speed, quality, and low-latency preferences with lifecycle cleanup and bounded restore |
| Metrics | `createMetricsPlugin()` | `src/plugins/metrics.ts` | Reporter-based plugin factory; products provide their own callbacks/reporters |
| Performance monitor | `createPerformanceMonitorPlugin()` | `src/plugins/performance.ts` | Optional budget/sampling plugin; emits `PERFORMANCE_BUDGET` QoS warnings without changing playback |
| Reconnect logs | `createReconnectPlugin()` | `src/plugins/reconnect.ts` | Optional diagnostics callbacks/logging with lifecycle cleanup; not reconnect policy owner |
| Diagnostics snapshot/export/debug panel | `createDiagnosticsPlugin()`, `createDebugPanelPlugin()` | `src/plugins/diagnostics.ts` | Optional support/QA surface that collects state, source, Tech, stats, network, QoS, retry and ICE clues, with a lightweight DOM panel when enabled |
| Auth/signing/recovery | `createAuthSigningMiddleware()`, `createAuthRecoveryPlugin()` | `src/plugins/auth.ts` | Optional request/signal middleware helper plus runtime recovery plugin for explicit 401/403 or custom expiry matchers |
| Source resolver | `createSourceResolverMiddleware()` | `src/plugins/engines/sourceResolver.ts` | Converts `auto` sources through `EngineFactory` into primary/fallback `Source` objects |
| Metadata parser | `createMetadataPlugin()` | `src/plugins/metadata/KlvBridge.ts` | Optional parser bridge for KLV/SEI/private-data business semantics |
| Generic render outputs | `CanvasFrameBuffer`, `BaseTarget` | `src/render/` | Generic video/canvas bridge helpers only; PSV/Cesium/map/panorama adapters stay external |
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
| Render targets | `render/` abstractions plus external PSV/Cesium docs and `docs/render-bridges.md` | Keep external renderers as plugins/adapters |
| GB28181 gateway control / PTZ | Built-in adapter Tech | Keep as thin invite/control adapter. `player.control('gb:ptz')` submits UI/business intent plus session context to the gateway; full SIP/RTP/PS, GB PTZ XML/SIP MESSAGE, ONVIF/vendor SDK mapping, permissions, and device execution state belong in backend or external gateway packages |

---

## 4. Candidate Plugins

| Plugin | Priority | Status | Why Plugin |
|---|---|---:|---|
| Analytics/Reporter | P1 | partial | Metrics and performance reporter hooks exist; deployment-specific exporters are still external |
| Error UX / Error Codes | P1 | partial | Core emits structured errors and diagnostics can export them; products still decide final display/reporting |
| Source Resolver | P1 | done | Engine URL conversion and fallback chains are vendor/project-specific |
| Auth / Signing | P1 | done | Middleware helper exists for headers, credentials, token injection, URL signing, and refreshed headers; recovery plugin can refresh app-owned auth state and reload current source on explicit 401/403 or custom matcher |
| Playback Preferences | P2 | done | Volume, mute, speed, source, quality, and low-latency preference persistence are optional storage plugin features |
| Metadata Parser | P2 | done | KLV, SEI, ID3, and private data semantics differ by domain; `createMetadataPlugin()` keeps parsing optional |
| Debug Panel | P1 | partial | Lightweight diagnostics panel exists; richer branded support-console UX remains product UI work |
| Performance Monitor | P2 | done | Sampling/budget rules are optional and product-tunable |
| Screenshot / Recording | P2 | done for current scope | UI screenshot download/feedback and recording toggle hook exist; backend recording API plugin supports start/stop/status, structured recording events, and normalized backend errors. Browser-side recording, permissions, storage, retention, and privacy policy stay out of scope/product-owned |
| Render Target Bridge | P2 | done for player package boundary | `docs/render-bridges.md` documents external bridge ownership and supported video/canvas/event/metadata outputs; concrete PSV/Cesium/map adapters remain external |
| PanoramaLite | P2 | done for product-demo scope; hardening continues | First-party lightweight WebGL2 equirectangular panorama renderer plugin for panoramic video, panoramic images, and live panorama playback. API, renderer, texture binding, panorama drag/zoom, optional in-view playback/fullscreen controls, source-type orientation defaults, non-degrading render scheduling, unit coverage, demo, and Edge smoke evidence exist. Upload/canvas caps remain optional fallback knobs. Keep it dependency-free; see `docs/panoramalite.md` |
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
- diagnostics/debug panel plugin entrypoints;
- auth/signing middleware helper for construction-time middleware composition;
- auth recovery plugin for explicit 401/403 or product-provided expiry matchers;
- `preference` event for pluginized playback preference persistence;
- UI action hooks for diagnostics, screenshot, and recording toggle;
- backend recording API plugin handle/events and normalized backend error codes;

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
| PL-001 | P1 | done: keep UI as explicit plugin | README/API/code agree |
| PL-002 | P1 | done: convert engine URL resolution into a documented resolver middleware pattern | `auto` source examples can use `createSourceResolverMiddleware()` without app-specific glue |
| PL-003 | P1 | done: turn metrics into reporter plugin factory | Consumers can provide endpoint/callback without editing plugin code |
| PL-004 | P2 | done: wrap `KlvBridge` into `createMetadataPlugin()` | Metadata parsing can be enabled with one plugin |
| PL-005 | P2 | done: add controlled third-party Tech registration API | External Techs do not need to patch `FyraPlayer` constructor |
| PL-006 | P3 | Keep DRM and subtitles as plugin placeholders | No core implementation until playback baseline is stable |
| PL-007 | P2 | done: add optional performance budget monitor | Consumers can track FPS/latency/backpressure budgets without core playback coupling |
| PL-008 | P1 | done: add lifecycle-safe storage/reconnect plugin factories | Built-in utility plugins detach listeners on destroy |
| PL-009 | P1 | done: add optional diagnostics snapshot/export/debug panel plugin | Support/QA can inspect current state and export recent evidence without parsing console output |
| PL-010 | P1 | done: add auth/signing and recovery helpers | Commercial token/header/signature policies can be composed without core changes; optional recovery can refresh app-owned auth state and reload the current source without adding auth policy to core |
| PL-011 | P2 | done: expand playback preference persistence | Volume/mute/speed/low-latency/quality preferences stay optional and scoped |
| PL-012 | P2 | done for current capture scope; render bridges remain external | UI screenshot and recording-toggle hooks exist; backend recording API plugin support exists with structured errors; browser recording stays out of scope; PSV/Cesium/map/panorama integrations stay out of core |
| PL-013 | P2 | done: document render bridge boundary | `docs/render-bridges.md` defines the bridge contract without adding renderer dependencies to core |
| PL-014 | P2 | done for product-demo scope; hardening continues | Lightweight WebGL2 panorama plugin supports equirectangular image/video/live sources without Three.js/PSV/WebGPU dependencies. Current hardening items are long-run WebGL resource sampling, controlled source-switch/context-restore browser evidence, and deployment-specific orientation validation |

---

## 7. Decision Checklist

Before adding a new feature to core, answer:

- Is playback impossible without this feature?
- Does every protocol Tech need it?
- Does it need business-specific configuration?
- Can it be implemented by listening to events or middleware?
- Can it be removed from a bundle without breaking basic playback?

If the answer favors optional behavior, make it a plugin.
