# FyraPlayer Commercial Readiness Roadmap

> Created: 2026-05-16  
> Owner: FyraPlayer maintainers  
> Purpose: keep architecture review findings, priorities, follow-up tasks, and verification history in one durable place.

This document is the long-term tracking baseline for moving FyraPlayer from an internal/vertical integration player toward a commercial-grade player SDK. It is intentionally conservative: a capability is not considered done until it has code, tests or repeatable manual verification, and documented operational boundaries.

---

## 1. Current Position

FyraPlayer currently has a good architectural direction and broad protocol coverage, but it should not yet be treated as a commercial-grade general-purpose player SDK.

Recommended positioning:

- Suitable: internal validation, controlled project integration, protocol experiments, GB28181/WebRTC/HLS scenario hardening.
- Not yet suitable: public commercial SDK promise, unattended production rollout across unknown streams/browsers, DRM-protected consumer media delivery.
- Current commercial baseline is summarized in `docs/supported-scenarios.md`.

Primary blockers found on 2026-05-16:

- Build and test are not reproducible in the current workspace.
- Public API, docs, and implementation have drift.
- Core playback paths need stronger lifecycle, observability, and long-run stability guarantees.
- ws-raw/WebCodecs path is valuable but still experimental as a commercial primary path.
- Browser/runtime compatibility matrix is not yet formalized.

---

## 2. Scope Control

The current focus is stability and correctness of the existing low-latency playback core.

Plugin boundary reference:

- Use `docs/pluginization-map.md` when deciding whether a new capability belongs in core or should be optional.
- Default to plugin/adaptor form for UI, analytics, auth, metadata parsing, render integrations, DRM, subtitles, and business workflow features.

In scope now:

- Reproducible build/test environment.
- API/docs/source consistency.
- WebRTC, HLS, DASH, fMP4, ws-raw, GB28181 playback stability.
- Resource cleanup, reconnect/fallback behavior, metrics, and error semantics.
- Minimal but reliable UI/plugin integration.
- Real-stream verification and repeatable test matrix.

Deferred pluginized scope:

- DRM/EME support.
- Subtitles/text tracks/captions.
- Advanced ad insertion, analytics exporters, and enterprise integrations.
- Any non-playback business workflow modules.

DRM and subtitles should be designed as optional plugins or Tech-specific adapters later. They should not block the current P0/P1 work unless a core API decision would make later pluginization impossible.

---

## 3. Priority Model

P0 means the project cannot be trusted without it. P1 means it is required before broader production use. P2 means it improves maintainability, performance, or product completeness after the foundation is stable. P3 means future extension.

Status values:

- `todo`: not started.
- `doing`: active work exists but not closed.
- `blocked`: cannot proceed until a dependency is resolved.
- `done`: implemented and verified.
- `deferred`: intentionally parked.

---

## 4. Tracking Board

| ID | Priority | Status | Area | Task | Acceptance |
|---|---|---:|---|---|---|
| CR-001 | P0 | done | Build/Test | Make `pnpm build` and `pnpm test` reproducible from a clean checkout | Commands pass without manual dependency repair; lockfile/workspace ownership is documented |
| CR-002 | P0 | done | TypeScript | Restore strict `tsc -p tsconfig.json` success | No implicit `any`; third-party package types resolve |
| CR-003 | P0 | done | API Consistency | Align docs and public API for `currentTime`, UI options, events, and exports | README/docs examples compile against package exports |
| CR-004 | P0 | done | Release Hygiene | Define package entrypoints and bundle contract | `exports`, `dist`, examples, and docs agree |
| CR-005 | P1 | doing | Test Matrix | Add browser/manual verification matrix for core protocols | Matrix covers Chrome/Edge/Safari where applicable, with stream URLs and expected events |
| CR-006 | P1 | doing | WebRTC/Reconnect | Harden session lifecycle, ready/error semantics, reconnect and stats | Chrome + local MediaMTX WHEP startup/stats/destroy-recreate are verified; Player reconnect same-Tech retry and pending timer clearing are unit-covered; real disconnect/reconnect, Edge, and long-run cases remain pending |
| CR-007 | P1 | done | HLS/DASH | Normalize ready/error/level/stats semantics and HLS live config boundaries | `ready` means playable or explicitly documented; error recovery behavior is tested; normal HLS is explicitly buffered while LL-HLS remains opt-in |
| CR-008 | P1 | doing | fMP4 | Add buffer queue backpressure and quota policy | `pendingBuffers` has bounded memory behavior under slow/blocked SourceBuffer |
| CR-009 | P1 | done | ws-raw | Decide commercial path for experimental pipeline vs MSE fallback | Default behavior and experimental contract are documented and tested |
| CR-010 | P1 | done | GB28181 | Define server-gateway adapter boundary for invite/bye/ptz/query and standard FLV/TS playback URLs | Unit adapter contract is covered; real backend/device verification remains tracked in `CR-005` |
| CR-011 | P1 | done | Observability | Standardize error codes, network events, metrics, and QoS payloads | Consumers can handle events without parsing console output |
| CR-012 | P1 | done | UI/Plugin | Make UI integration explicit and lifecycle-safe | UI is plugin-only and shell lifecycle cleanup is verified |
| CR-013 | P2 | doing | Performance | Profile WebCodecs/canvas/WebGL render paths | Budget monitor and target thresholds are documented; real long-run/browser profiling evidence remains pending |
| CR-014 | P2 | done | Docs | Add "known limitations" and "supported scenarios" docs | Users can tell what is stable, experimental, or unsupported |
| CR-015 | P3 | deferred | DRM | Keep DRM as plugin placeholder and Tech adapter design | EME integration can be added without changing core player shape |
| CR-016 | P3 | deferred | Subtitles | Keep subtitles/text-tracks as plugin placeholder | HLS/DASH/native text tracks can be exposed later without blocking core work |
| CR-017 | P1 | done | Plugins | Align plugin boundaries with `docs/pluginization-map.md` | Core/plugin split is documented before new feature work expands |

---

## 5. Commercial Readiness Gates

### Gate A: Engineering Baseline

Required before larger feature work:

- `pnpm install`, `pnpm build`, and `pnpm test` are reproducible.
- TypeScript strict build passes.
- CI or a documented local verification script exists.
- README and docs do not reference APIs that do not exist.

### Gate B: Playback Reliability

Required before production pilot:

- Real stream verification exists for WebRTC, HLS, DASH, ws-raw/fallback, fMP4, and GB28181 gateway integrations if those are advertised.
- Destroy/recreate, source switch, network failure, and autoplay-blocked cases are covered.
- Memory growth during long-run playback is measured for at least one representative live scenario.

### Gate C: SDK Contract

Required before commercial SDK positioning:

- Public events have stable payload shapes.
- Error codes and recovery expectations are documented.
- Plugin lifecycle is documented and tested.
- Bundle entrypoints and optional dependencies are intentional.
- Supported scenarios and known limitations are documented for product teams.

### Gate D: Product Extensions

Only after Gates A-C:

- DRM plugin.
- Subtitle/text track plugin.
- Advanced analytics/reporting plugins.
- Enterprise-specific integrations.

---

## 6. Deferred Plugin Placeholders

### DRM Plugin Placeholder

Target shape:

```ts
type DrmPluginOptions = {
  keySystems: Record<string, {
    licenseUrl: string;
    headers?: Record<string, string>;
  }>;
};
```

Notes:

- HLS and DASH should pass DRM config to hls.js/dash.js adapters.
- Native EME setup should stay out of core player until the stable playback contract is settled.
- DRM work must include browser compatibility notes and failure states.

### Subtitles/Text Tracks Plugin Placeholder

Target shape:

```ts
type TextTrackPluginOptions = {
  defaultLanguage?: string;
  externalTracks?: Array<{
    src: string;
    kind: 'subtitles' | 'captions' | 'metadata';
    srclang: string;
    label: string;
  }>;
};
```

Notes:

- Treat subtitles as UI/API surface plus Tech adapter support.
- Do not block playback reliability work on this feature.

---

## 7. Review Log

### 2026-05-16 Review

Summary:

- The project has a reasonable modular architecture: player core, Tech abstraction, middleware, plugin manager, UI module, wsRaw pipeline, and engine helpers.
- It is not yet commercial-grade because current build/test reproducibility failed and several API/docs promises are not fully implemented.
- DRM and subtitles were explicitly moved out of the current critical path and should be handled as later plugins.
- Added pluginization decision map to prevent optional capabilities from drifting into core.

Verification attempted:

- `pnpm build`: failed because pnpm tried to repair/install workspace dependencies and aborted in non-interactive mode.
- `pnpm test -- --runInBand`: failed for the same package/workspace reason.
- Direct `.bin\tsc.CMD -p tsconfig.json`: failed on unresolved third-party modules plus an implicit `any` in `tech-hls.ts`.
- Direct `.bin\jest.CMD --runInBand`: failed because the current dependency layout cannot resolve `import-local`.

Next action:

- Start with `CR-001` and `CR-002`. Do not expand feature scope before the engineering baseline is reproducible.

### 2026-05-16 Build/Test Baseline Repair

Summary:

- Restored the package-local build and test baseline for `fyraplayer`.
- Root cause was environmental and version-related:
  - `node_modules` junctions pointed to the old path `D:\Desktop\YT\beevizproject\...` while the current checkout is under `G:\YT\beevizproject\...`;
  - global pnpm is `11.1.2`, while the previous package lockfile was `lockfileVersion: '6.0'`;
  - pnpm 11 required explicit build approval for `esbuild`.
- Added package-local `pnpm-workspace.yaml` with `allowBuilds.esbuild: true`.
- Updated package lockfile to pnpm lockfile v9 through the package-local install flow.
- Fixed `dashjs` v5 typing compatibility by using namespace import in `tech-dash.ts`.
- Removed the explicit `@jest/globals` import from `tests/player.test.ts`; Jest globals are already available in the configured test environment.

Validation:

- `.\\node_modules\\.bin\\tsc.CMD -p tsconfig.json`: passed.
- `.\\node_modules\\.bin\\jest.CMD --runInBand`: passed, 9 suites / 32 tests.
- `pnpm build`: passed.
- `pnpm test -- --runInBand`: passed, 9 suites / 32 tests.

Follow-up:

- Avoid running `pnpm build` and `pnpm test` concurrently in the same working tree; concurrent pnpm auto-install checks can race on `node_modules/.pnpm/lock.yaml` on Windows.
- The wider parent workspace still has unrelated dependency/lockfile inconsistencies. This baseline only proves the `fyraplayer` package-local workflow.

### 2026-05-16 API Consistency Pass

Summary:

- Added `FyraPlayer.currentTime` so README/API KLV synchronization examples match the public class behavior.
- Updated `PlayerAPI` with typed event overloads for core player events while keeping a string fallback for custom plugin events.
- Added existing ws-raw metadata helper methods to `PlayerAPI`: `enableMetadataExtraction()`, `disableMetadataExtraction()`, `getDetectedPrivateDataPids()`, and `getDetectedSeiTypes()`.
- Clarified the UI decision: UI is enabled through `createUiComponentsPlugin()` and is not configured through `PlayerOptions.ui`.
- Updated package docs to use current dependency versions and to describe `PlayerNetworkEvent` / `MetadataDetectedEvent`.
- Added `pnpm check:public-api` with a public API smoke file covering package-style imports, typed events, `currentTime`, metadata helpers, and the UI plugin factory.

Validation:

- `pnpm build`: passed.
- `pnpm test -- --runInBand`: passed, 9 suites / 33 tests.
- `pnpm check:public-api`: passed.

Follow-up:

- UI shell teardown is covered under the UI/plugin lifecycle pass.
- Test source-control hygiene is handled under the release hygiene pass.

### 2026-05-17 Release Hygiene Pass

Summary:

- Added a deterministic `clean` script and changed `pnpm build` to clean `dist/` before TypeScript emit.
- Added `pnpm check:exports`, which rebuilds and verifies every `package.json` `main` / `module` / `types` / `exports` file exists.
- Added `checks/export-contract.mjs` so stale or missing package entrypoints fail locally before release.
- Added the advanced `fyraplayer/techs/wsRaw/demuxer` subpath export because docs expose it for offline KLV/TS parsing.
- Extended `checks/public-api-smoke.ts` to compile package-style imports for the UI plugin and demuxer subpath.
- Updated PSV integration docs to point to external `@beeviz/fyrapano` ownership instead of a nonexistent `fyraplayer` main export.
- Removed `tests/` from `.gitignore` so test assets are visible to source control and long-term review.

Validation:

- `pnpm check:public-api`: passed.
- `pnpm check:exports`: passed, verified 20 package export files.

Remaining:

- `CR-005` still needs a real browser/protocol verification matrix; this pass only fixes package/release contract hygiene.

### 2026-05-17 UI Plugin Lifecycle Pass

Summary:

- `createUiComponentsPlugin()` now returns a lifecycle object with `destroy()`.
- UI plugin destroy removes the `fyra-ui-shell` element, restores the previous video `controls` state/attribute, removes the container class only when the plugin added it, and restores the host inline position.
- Added `tests/ui-components.test.ts` to verify plugin teardown behavior with a minimal DOM stub.

Validation:

- `pnpm test -- tests/ui-components.test.ts --runInBand`: passed.

### 2026-05-17 Playback Verification Matrix Pass

Summary:

- Added `docs/playback-verification-matrix.md` as the evidence log for real browser/protocol verification.
- Defined protocol coverage for HLS, DASH, MP4, HTTP-FLV/ws-raw fallback, local MediaMTX WebRTC/HLS, GB28181, and fMP4.
- Defined browser scope for Chrome, Edge, Safari, and Firefox, with explicit promotion rules.
- Added scenario checklist for init/play, pause/play, VOD seek, source switch, destroy/recreate, network interruption, and long-run live playback.
- Added `pnpm check:sources` and `checks/sources-contract.mjs` to validate `examples/sources.js` structure.
- Linked the playback matrix from README.

Validation:

- `pnpm check:sources`: passed, 14 example sources verified.

Remaining before closing `CR-005`:

- Run and record real browser playback results in `docs/playback-verification-matrix.md`.
- Add at least Chrome and Edge evidence for HLS, DASH, MP4, and ws-raw fallback.
- Add local MediaMTX evidence for WebRTC/HLS or document backend blockers.
- GB28181 and fMP4 require project-specific streams; placeholders do not count as commercial verification.

### 2026-05-17 Chrome Playback Evidence And Event Semantics Pass

Summary:

- Ran the demo in Chrome 148.0.0.0 on Windows through Playwright against the Vite example server on `http://127.0.0.1:4173/basic.html`.
- First browser run exposed a core event timing defect: HLS media reached `readyState=4`, but `FyraPlayer` stayed in `loading` because Tech-level `ready` could be emitted before Player attached Tech event forwarding.
- Updated `TechManager`/`FyraPlayer` so Tech events are attached before `load()` runs; added a regression test for synchronous `ready` during Tech load.
- Tightened HLS/DASH semantics:
  - HLS `ready` now waits for buffered media; non-fatal hls.js startup buffer events are surfaced as `network` warnings instead of player `error`.
  - DASH `ready` now waits for browser/dash.js playable metadata instead of firing immediately after `initialize()`.
  - Player no longer emits a duplicate `play` event after Tech already emitted `play`.
  - `levelSwitch` payloads are normalized to stable small objects instead of leaking hls.js/dash.js internal event structures.
- Recorded Chrome pass evidence in `docs/playback-verification-matrix.md` for HLS VOD, DASH VOD, MP4, and HTTP-FLV/ws-raw fallback.

Validation:

- `pnpm check:public-api`: passed.
- `pnpm test -- --runInBand`: passed, 10 suites / 35 tests.
- `pnpm build`: passed.
- `pnpm bundle:examples`: passed.
- Browser smoke evidence:
  - HLS VOD: `playing`, `1280x720`, `ready=1`, `play=1`, `stats=2`.
  - DASH VOD: `playing`, `480x270`, `ready=1`, `play=1`, `stats=1`, `levelSwitch=2`.
  - MP4: `playing`, `640x360`, `ready=1`, `play=1`, `stats=2`.
  - HTTP-FLV/ws-raw fallback: `playing`, `640x360`, `ready=1`, `play=1`, `stats=1`.

Remaining before closing `CR-005`:

- Run Edge evidence for HLS, DASH, MP4, and ws-raw fallback.
- Run Safari/Firefox where available or explicitly record unsupported/unavailable environment.
- Add local MediaMTX WebRTC/HLS evidence or document backend blockers.
- Add long-run checks; Chrome browser lifecycle evidence for HLS pause/play, HLS seek, HLS -> DASH source switch, and DASH destroy -> HLS recreate was added later on 2026-05-17.

### 2026-05-17 HLS/DASH Event Contract Test Pass

Summary:

- Added `tests/hls-dash-events.test.ts` to lock down HLS and DASH Tech event contracts without depending on a live browser stream.
- Covered HLS non-fatal hls.js errors as `network` warnings rather than player `error`.
- Covered HLS fatal errors as player `error` plus fatal `network` event, with recovery attempt.
- Covered HLS `ready` emission from buffered media and stable `levelSwitch` payload shape.
- Covered DASH fatal vs non-fatal error mapping.
- Covered DASH `ready` de-duplication and stable `levelSwitch` payload shape.
- Updated `docs/api.md` with the public HLS/DASH `ready`, `network`, and `levelSwitch` event semantics so integration docs match tested behavior.

Validation:

- `pnpm test -- tests/hls-dash-events.test.ts --runInBand`: passed, 1 suite / 5 tests.
- `pnpm exec jest --runInBand`: passed, 11 suites / 40 tests.
- `pnpm check:public-api`: passed.
- `pnpm build`: passed.
- `pnpm check:sources`: passed, 14 example sources verified.

Environment note:

- An attempt to run `pnpm test -- --runInBand` and `pnpm check:public-api` in parallel timed out on Windows after the commands had started. Full validation was then rerun serially through `cmd`; use `pnpm exec jest --runInBand` when invoking Jest directly from `cmd`, because `cmd /c pnpm test -- --runInBand` can pass `--runInBand` as a Jest pattern.

Remaining before closing `CR-007`:

- Add or verify seek/recovery tests for HLS/DASH where feasible.
- Document the final fatal/non-fatal error code policy in API docs once the observed browser/backend cases are complete.

### 2026-05-17 Player Lifecycle Regression Pass

Summary:

- Added Player-level lifecycle regression coverage for `pause -> play`, `seek`, `switchSource`, and `destroy -> recreate`.
- Fixed `FyraPlayer.switchSource()` to detach Player event forwarding from the old Tech before destroying it.
- This prevents late events from a previous Tech instance from changing Player state or emitting public events after a source switch.
- Extended mock Techs with call counters so active-Tech delegation is verified rather than only inferred.
- Updated `docs/playback-verification-matrix.md` to mark lifecycle checklist items as unit-covered.

Validation:

- `pnpm exec jest tests/player.test.ts --runInBand`: passed, 1 suite / 8 tests.
- `pnpm exec jest --runInBand`: passed, 11 suites / 43 tests.
- `pnpm check:public-api`: passed.
- `pnpm build`: passed.
- `pnpm check:sources`: passed, 14 example sources verified.

Remaining:

- Browser-run lifecycle evidence is still needed outside Chromium/Chrome before closing `CR-005`.
- Protocol-specific HLS/DASH recovery behavior still needs real-stream/browser verification before closing `CR-007`.

### 2026-05-17 Chromium Lifecycle Evidence Pass

Summary:

- Ran the Vite demo in Playwright-provided Chromium 148.0.7778.168 on Windows.
- Rebuilt `examples/bundle.js` before the browser run so the demo used the current player implementation.
- Added browser evidence for HLS `pause -> play`, HLS VOD seek, HLS -> DASH source switch, and DASH destroy -> HLS recreate.
- Confirmed no fatal `error` or `network` events during the lifecycle run.
- Edge was not verified in this environment: `msedge`, `chrome`, and `playwright` CLIs were not available on PATH; the available MCP browser is Chromium.

Browser evidence:

- HLS lifecycle: reached `playing`, `1280x720`; pause reached Player `paused`; resume returned to `playing`; seek target `12.00s` resumed at `12.94s`.
- HLS -> DASH switch: reached Player `playing`, source `dash`, `480x270`, with DASH `ready=1`, `play=1`, `levelSwitch=2`.
- DASH destroy -> HLS recreate: destroyed DASH Player returned old state to `idle`; recreated HLS reached `playing`, source `hls`, `1280x720`, with `ready=1`, `play=1`, `stats=1`.

Validation:

- `pnpm bundle:examples`: passed.
- Browser run on `http://127.0.0.1:4173/basic.html`: passed for the lifecycle scenarios above.

Remaining before closing `CR-005`:

- Edge evidence for startup and lifecycle scenarios.
- Safari/Firefox availability or explicit unsupported/unavailable notes.
- Local MediaMTX WebRTC/HLS evidence.
- Network interruption and long-run memory/listener checks.

### 2026-05-17 Scope Adjustment: WebRTC/MediaMTX Deferred

Summary:

- `CR-006` remains important, but local MediaMTX/WebRTC verification is intentionally deferred.
- Reason: it depends on a local backend, a published test stream, and browser/network environment. Current work should continue on core contracts that do not require external services.
- `CR-005` still keeps MediaMTX WebRTC/HLS rows as pending evidence; do not mark WebRTC commercial-ready without a later real backend run.
- Superseded note: local MediaMTX HLS/WHEP evidence was later added on 2026-05-17 in "Local MediaMTX HLS/WHEP Evidence Pass". This historical note explains why the task paused earlier in the day; it is no longer the current status.

Next action when resumed:

- Start MediaMTX, publish a stream, verify WHEP startup, disconnect/reconnect, destroy/recreate, and stats payload.

### 2026-05-17 Local MediaMTX HLS/WHEP Evidence Pass

Summary:

- Resumed `CR-005` and started practical `CR-006` validation with the user's local MediaMTX v1.18.2 and OBS RTMP publishing.
- Added local MediaMTX demo presets:
  - HLS: `http://127.0.0.1:8888/live/test/index.m3u8`
  - WHEP: `http://127.0.0.1:8889/live/test/whep`
- Verified MediaMTX HLS in Chrome through FyraPlayer/hls.js:
  - playlist, init segments, and media parts returned 200;
  - playback reached `ready`, `play`, `stats`, `1280x720`, about 2 Mbps and about 30 fps;
  - hls.js startup warnings remained non-fatal `HLS_WARNING` events.
- Verified MediaMTX WHEP in Chrome through `tech-webrtc`:
  - WHEP POST returned 201 and ICE reached `checking -> connected`;
  - playback reached `readyState=4`, `1280x720`, `currentTime=10.627s`;
  - public events included `ready=1` and `stats` with `bitrateKbps=2365`, `fps=30`, `rttMs=1`, `packetLoss=0`, `candidateType='host'`, `transport='udp'`;
  - no fatal `network` events were observed.
- Fixed WebRTC issues exposed by the real stream run:
  - `ready` is now de-duplicated across connection-state and video-loaded events;
  - WebRTC stats fall back to the video element dimensions when RTC track stats omit width/height;
  - WebRTC destroy/reset clears video callbacks and media source to avoid public empty-source `video-error` noise during reloads;
  - the demo now waits for the previous player destroy before creating a new one.
- Verified WHEP destroy -> recreate twice in the browser with `readyCount=1`, `errorCount=0`, `videoErrorNetworkCount=0`, `fatalNetworkCount=0`.

Validation:

- `pnpm exec jest tests/webrtc-tech-stats.test.ts --runInBand`: passed, 1 suite / 3 tests.
- `pnpm check:public-api`: passed.
- `pnpm bundle:examples`: passed.
- Browser run on `http://127.0.0.1:4185/basic.html`: passed for MediaMTX HLS, WHEP startup/stats, and WHEP destroy -> recreate.

Remaining:

- `CR-005` still needs Edge/Safari/Firefox evidence where applicable.
- `CR-006` still needs controlled network interruption/reconnect evidence and longer live-run stability before it can close.
- `CR-013` still needs long-run performance evidence; the WHEP stats run is useful evidence, not a full performance profile.

### 2026-05-17 ws-raw Commercial Pipeline Contract Pass

Summary:

- Started `CR-009`.
- Clarified that `ws-raw` defaults to the stable MSE path (`pipeline: 'mse'`) using `mpegts.js`.
- Added `WSRawSource.pipeline?: 'mse' | 'experimental'`.
- Kept the legacy `experimental: true` boolean as a deprecated compatibility alias for `pipeline: 'experimental'`.
- Updated `WSRawTech` so only `pipeline: 'experimental'` or `experimental: true` enables the in-house WebCodecs/WASM pipeline.
- Documented that metadata extraction from TS currently belongs to the experimental demux pipeline, not the stable MSE-only contract.
- Updated README/API docs with the stable vs experimental ws-raw contract.
- Added `tests/ws-raw.tech.test.ts` to lock down default MSE behavior, explicit experimental opt-in, legacy alias behavior, and fallback to MSE after experimental startup failure.
- Extended `checks/public-api-smoke.ts` so `WSRawSource.pipeline: 'mse' | 'experimental'` is compiled as part of the public API contract.
- Added Chromium browser evidence for HTTP-FLV/ws-raw default MSE playback.

Validation:

- `pnpm exec jest tests/ws-raw.tech.test.ts --runInBand`: passed, 1 suite / 4 tests.
- `pnpm exec jest --runInBand`: passed, 12 suites / 47 tests.
- `pnpm check:public-api`: passed.
- `pnpm build`: passed.
- `pnpm check:sources`: passed, 14 example sources verified.
- `pnpm bundle:examples`: passed.
- Browser run on `http://127.0.0.1:4173/basic.html`: HTTP-FLV/ws-raw default MSE path reached playable video, `640x360`, no fatal `error`/`network` events.

Remaining before closing `CR-009`:

- Decide whether metadata parsing should become a plugin factory before claiming it as a stable ws-raw feature.

### 2026-05-17 Metadata Plugin Boundary Pass

Summary:

- Closed the remaining `CR-009` metadata boundary decision.
- Added `createMetadataPlugin()` as an optional plugin wrapper around `KlvBridge`.
- Core playback remains parser-agnostic: it emits raw `metadata` events but does not parse KLV/MISB/SEI business semantics.
- Metadata parsing is now a plugin capability; products provide their own parser and receive parsed data through `onData`.
- Detect-only discovery events are not sent to raw parsers by default; plugins can handle them through `onDetected`.
- Plugin teardown calls `player.off('metadata', handler)` so metadata parsing does not leak after player destroy/plugin unregister.
- Marked `PL-004` done in `docs/pluginization-map.md`.
- Updated `docs/api.md` and `checks/public-api-smoke.ts` for `fyraplayer/plugins/metadata`.

Validation:

- `pnpm exec jest tests/metadata-plugin.test.ts --runInBand`: passed, 1 suite / 4 tests.
- `pnpm check:public-api`: passed.
- `pnpm exec jest --runInBand`: passed, 13 suites / 51 tests.
- `pnpm build`: passed.
- `pnpm check:exports`: passed, verified 20 package export files.
- `pnpm check:sources`: passed, 14 example sources verified.

Result:

- `CR-009` is now `done`: stable ws-raw default is MSE, experimental demux/WebCodecs/WASM is explicit opt-in, and metadata parsing is pluginized rather than part of the stable MSE playback contract.

### 2026-05-17 fMP4 Backpressure Pass

Summary:

- Advanced `CR-008` from `todo` to `doing`.
- Added `BufferPolicy.fmp4` with bounded queue and quota controls:
  - `maxPendingSegments`
  - `maxPendingBytes`
  - `overflowStrategy`
  - `quotaCleanupKeepBehindMs`
  - `quotaRetryLimit`
- `FMP4Tech` now tracks pending bytes and emits stable network diagnostics for:
  - `FMP4_BACKPRESSURE`
  - `FMP4_QUOTA_EXCEEDED`
- Queue overflow is bounded by default and can be tuned per source or player buffer policy.
- Added unit coverage for overflow `drop-oldest`, fail-fast `error`, quota cleanup/retry, and retry exhaustion.
- Public API smoke and docs were updated to match the new `buffer.fmp4` contract.

Validation:

- `pnpm exec jest tests/fmp4-tech.test.ts --runInBand`: passed, 1 suite / 4 tests.

Remaining:

- Browser verification for real fMP4 sources is still pending in `CR-005`.
- If a project-specific fMP4 source becomes available, record bounded-buffer behavior in `docs/playback-verification-matrix.md` and then consider closing `CR-008`.

### 2026-05-17 HLS/DASH Semantics Closure

Summary:

- Closed `CR-007`.
- HLS and DASH public event semantics are now locked by unit tests and documented API behavior:
  - HLS non-fatal warnings stay as `network` warnings.
  - HLS fatal errors emit player `error` plus fatal `network` and invoke recovery.
  - DASH non-fatal errors emit `network` warnings.
  - DASH `ready` waits for playable media evidence and `levelSwitch` payloads stay normalized.
- Browser lifecycle evidence in `docs/playback-verification-matrix.md` already covers pause/play, seek, source switch, and destroy/recreate flows on Chromium.

Validation:

- `pnpm exec jest tests/hls-dash-events.test.ts --runInBand`: passed, 1 suite / 5 tests.
- `pnpm exec jest --runInBand`: passed, 17 suites / 78 tests.
- `pnpm build`: passed.

Remaining:

- Cross-browser protocol evidence still belongs to `CR-005`.

### 2026-05-17 Support Scenarios Doc

Summary:

- Added `docs/supported-scenarios.md` to separate product-facing support claims from the broader roadmap.
- The doc states the current verified baseline, conditional scenarios, and explicit limitations.
- Linked the new doc from `README.md` so support boundaries are discoverable from the package entrypoint.

Validation:

- `pnpm build`: passed.
- `pnpm check:public-api`: passed.

Result:

- `CR-014` is done. The product-facing support boundary now lives in `docs/supported-scenarios.md`, with the detailed evidence trail still anchored by `docs/playback-verification-matrix.md`.

### 2026-05-17 GB28181 Gateway Boundary Pass

Summary:

- Closed `CR-010` as a player-side gateway adapter contract, not as a browser-side GB28181 protocol stack.
- Clarified that SIP/RTP/PS, device invite lifecycle, PS demuxing, G.711 compatibility, and GB media conversion belong to the server-side GB gateway.
- Simplified `Gb28181Tech` so it calls gateway invite/control endpoints and plays the returned FLV/TS URL through the standard MSE path.
- Removed browser-side GB custom framing helpers, PS demuxer entry, and G.711 playback code from the ws-raw path.
- Updated demo controls so GB28181 only exposes gateway fields and FLV/TS output format.
- Rewrote `docs/gb28181.md` and updated API/support/verification docs to match the new boundary.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit`: passed.
- `tests/gb28181.tech.test.ts` covers invite request/auth config, response mapping, FLV vs TS MSE dispatch, PTZ/BYE/query/keepalive controls, missing endpoint error, and invite HTTP auth diagnostics.

Remaining:

- Real GB28181 commercial verification still requires a project-specific server gateway plus device or simulator evidence. That browser/backend evidence remains under `CR-005`.

### 2026-05-17 Metrics Reporter Plugin Pass

Summary:

- Continued `CR-017` plugin boundary work and closed `PL-003`.
- Added `createMetricsPlugin()` with configurable `onStats`, `onQos`, and `onEvent` reporter callbacks.
- Kept `metricsPlugin` as a backwards-compatible default console reporter.
- Added lifecycle cleanup: metrics plugin now unregisters `stats` and `qos` handlers on destroy.
- Exported the metrics plugin factory from `fyraplayer/plugins` and `fyraplayer/plugins/metrics`.
- Extended `checks/public-api-smoke.ts` for `createMetricsPlugin`, `metricsPlugin`, and `MetricsPluginOptions`.
- Updated `docs/pluginization-map.md` to mark `PL-003` done.

Validation:

- `pnpm exec jest tests/metrics-plugin.test.ts --runInBand`: passed, 1 suite / 3 tests.
- `pnpm check:public-api`: passed.
- `pnpm exec jest --runInBand`: passed, 14 suites / 54 tests.
- `pnpm build`: passed.
- `pnpm check:exports`: passed, verified 20 package export files.
- `pnpm check:sources`: passed, 14 example sources verified.

### 2026-05-17 Source Resolver Middleware Pass

Summary:

- Continued `CR-017` plugin boundary work and closed `PL-002`.
- Added `createSourceResolverMiddleware()` under `fyraplayer/plugins/engines`.
- Added `engineUrlsToResolvedSources()` so engine URL conversion can be tested and reused without constructing a Player.
- `auto` sources can now resolve through `EngineFactory` into a primary source plus ordered fallbacks without app-specific glue code.
- Resolver behavior respects engine `fallbackChain`, optional `protocols` override, `AutoSource.preferTech`, explicit `AutoSource.fallbacks`, and stable `ws-raw` MSE defaults for FLV outputs.
- Added public API smoke coverage for `fyraplayer/plugins/engines`.
- Updated adapter/API/pluginization docs to describe the middleware pattern.

Validation:

- `pnpm exec jest tests/source-resolver.test.ts --runInBand`: passed, 1 suite / 7 tests.
- `pnpm exec jest --runInBand`: passed, 15 suites / 61 tests.
- `pnpm check:public-api`: passed.
- `pnpm build`: passed.
- `pnpm check:exports`: passed, verified 20 package export files.
- `pnpm check:sources`: passed, 14 example sources verified.

### 2026-05-17 Third-party Tech Registration Pass

Summary:

- Continued and closed `CR-017` plugin boundary work by completing `PL-005`.
- Added controlled third-party Tech registration through `PluginContext.techs.register()`.
- Registration returns an idempotent handle with `unregister()` for plugin lifecycle cleanup.
- Added duplicate-name protection, explicit `replace: true` behavior, active-Tech replacement rejection, and `techOrder` insertion control.
- Added module augmentation hooks: `CustomTechNameMap` and `CustomSourceMap`, so external packages can type custom protocols without patching core unions.
- Replacing an inactive built-in Tech now restores the previous implementation when the plugin unregisters.
- Updated API and pluginization docs to show the supported third-party Tech plugin pattern.

Validation:

- `pnpm exec jest tests/tech-registration-plugin.test.ts --runInBand`: passed, 1 suite / 5 tests.
- `pnpm exec jest tests/techManager.test.ts tests/tech-registration-plugin.test.ts --runInBand`: passed, 2 suites / 11 tests.
- `pnpm exec jest --runInBand`: passed, 16 suites / 69 tests.
- `pnpm check:public-api`: passed.
- `pnpm build`: passed.
- `pnpm check:exports`: passed, verified 20 package export files.
- `pnpm check:sources`: passed, 14 example sources verified.

Result:

- `CR-017` is done. Remaining plugin candidates such as auth/signing, debug panel, renderer bridges, DRM, and subtitles are tracked as future optional plugins rather than blockers for the current plugin boundary baseline.

### 2026-05-17 Network Event Code Pass

Summary:

- Began `CR-011` observability work by adding a stable `PlayerNetworkEvent.code` contract.
- Added `PlayerNetworkCode` and `PlayerNetworkSeverity` public types.
- Added shared network event normalization under core so Tech-forwarded events, `TechManager` source fallback events, and Player-owned reconnect events use the same `code`, `severity`, and `message` rules.
- Kept `PlayerNetworkEvent.type` backwards-compatible as the original Tech event name; consumers should use `code` for stable business handling.
- Covered HLS warning normalization, WebRTC signaling WebSocket normalization, source fallback normalization, and Player reconnect-exhausted normalization.
- Fixed fatal network event ordering so the root cause event is emitted before the reconnect/reconnect-exhausted event.
- Updated `docs/api.md` and public API smoke coverage for the new network event code surface.

Validation:

- `pnpm exec jest tests/player.test.ts tests/techManager.test.ts --runInBand`: passed, 2 suites / 17 tests.
- `pnpm exec tsc -p tsconfig.json --noEmit`: passed.
- `pnpm exec jest --runInBand`: passed, 16 suites / 72 tests.
- `pnpm check:public-api`: passed.
- `pnpm build`: passed.
- `pnpm check:exports`: passed, verified 20 package export files.
- `pnpm check:sources`: passed, 14 example sources verified.

### 2026-05-17 QoS Event Contract Pass

Summary:

- Continued `CR-011` by stabilizing the public `qos` event payload.
- Added `PlayerStatsEvent`, `PlayerQosEvent`, `PlayerQosCode`, and `PlayerQosSeverity` public types.
- Added shared QoS normalization under core so Tech `qos` events retain raw `type` while gaining `code`, `severity`, `message`, `tech`, and `ts`.
- Kept `stats` as the existing `{ tech, stats }` event and documented it as `PlayerStatsEvent`.
- Updated `createMetricsPlugin()` so `onQos` receives the typed normalized `PlayerQosEvent`.
- Covered Player-level QoS normalization and metrics plugin QoS passthrough in tests.
- Updated `docs/api.md` and public API smoke coverage.

Validation:

- `pnpm exec jest tests/player.test.ts tests/metrics-plugin.test.ts --runInBand`: passed, 2 suites / 16 tests.
- `pnpm exec tsc -p tsconfig.json --noEmit`: passed.
- `pnpm check:public-api`: passed.
- `pnpm exec jest --runInBand`: passed, 16 suites / 74 tests.
- `pnpm build`: passed.
- `pnpm check:exports`: passed, verified 20 package export files.
- `pnpm check:sources`: passed, 14 example sources verified.

### 2026-05-17 Observability Browser Evidence Pass

Summary:

- Closed `CR-011` with browser-visible observability evidence.
- Updated the demo to log `qos` events, including stable `code`, so browser/manual runs can verify the public payload without opening debugger internals.
- Rebuilt `examples/bundle.js`.
- Ran the Vite demo on `http://127.0.0.1:4174/basic.html` in Chromium 148.0.7778.168 / Windows 10.
- Recorded browser evidence in `docs/playback-verification-matrix.md`:
  - `qos.code: "WEBCODECS_CONFIG"` from local MP4 WebCodecs configuration.
  - `network.code: "HLS_WARNING"` from HLS warning events.
  - `network.code: "WEBRTC_SIGNAL_ERROR"` and `RECONNECT_ATTEMPT` from a controlled WHEP-without-backend failure.
- The WHEP failure record validates event visibility and fatal/reconnect semantics only; it is not MediaMTX/WebRTC playback success.

Validation:

- `pnpm bundle:examples`: passed.

Result:

- `CR-011` is done. Network, stats, QoS, metrics reporter, public API smoke, unit tests, docs, and browser-visible demo evidence are aligned.

---

### 2026-05-17 Performance Budget Baseline Pass

Summary:

- Started `CR-013` with a code-level performance budget contract rather than claiming final optimization.
- Added `createPerformanceMonitorPlugin()` under `fyraplayer/plugins/performance`.
- The plugin consumes public `stats` events, normalizes samples, evaluates default or per-Tech budgets, reports `PerformanceViolation`, and can emit `qos` events with `code: 'PERFORMANCE_BUDGET'`.
- Added default warning budgets for FPS, dropped frames, decode/live latency, RTT, jitter, pending fMP4 queue size, and buffer level.
- Corrected built-in HTML video FPS sampling so `getVideoPlaybackQuality().totalVideoFrames` is converted into a frame-rate sample instead of being exposed as cumulative FPS.
- Added `docs/performance-baseline.md` and updated API/support/pluginization docs.

Validation:

- `pnpm exec jest tests/performance-plugin.test.ts tests/abstract-tech-stats.test.ts --runInBand`: passed, 2 suites / 7 tests.
- `pnpm check:public-api`: passed.

Remaining:

- Real long-run profiling evidence is still pending before closing `CR-013`.
- Record browser/runtime evidence for memory growth, fMP4 bounded-buffer behavior, WebRTC/MediaMTX stats, and cross-browser performance in `docs/playback-verification-matrix.md`.

---

### 2026-05-17 Utility Plugin Lifecycle Pass

Summary:

- Continued core reliability work that does not depend on external stream backends.
- Added `createStoragePlugin()` with explicit key/restore options, valid-index restore checks, and lifecycle cleanup for the `play` listener.
- Kept `storagePlugin` as the backwards-compatible default export.
- Added `createReconnectPlugin()` with optional callbacks/logging controls and lifecycle cleanup for `network` / `error` listeners.
- Kept `reconnectPlugin` as the backwards-compatible default export.
- Exported both factories from their subpaths and from `fyraplayer/plugins`.
- Updated API, support, and pluginization docs.

Validation:

- `pnpm exec jest tests/storage-reconnect-plugin.test.ts --runInBand`: passed, 1 suite / 5 tests.
- `pnpm check:public-api`: passed.
- `pnpm exec jest --runInBand`: passed, 19 suites / 89 tests.
- `pnpm build`: passed.
- `pnpm check:exports`: passed, verified 22 package export files.
- `pnpm check:sources`: passed, 14 example sources verified.
- `git diff --check`: passed.

Remaining:

- Long-run browser evidence is still needed to prove no memory/listener growth across repeated create/destroy cycles.

### 2026-05-17 MediaMTX Audio/Lifecycle Follow-up

Summary:

- Investigated user-reported local MediaMTX symptoms:
  - WebRTC video played but audio was silent.
  - HLS playback was smooth but audio appeared to repeat and layer after several seconds.
- Fixed player-side WebRTC audio behavior:
  - removed forced `video.muted = true` from `tech-webrtc`;
  - removed the extra `AudioContext.createMediaStreamSource(stream).connect(destination)` output path, so the `HTMLVideoElement` is the only WebRTC audio renderer;
  - added `WEBRTC_AUDIO_MUTED` diagnostics when a live WebRTC audio track remains browser-muted after startup.
- Hardened HLS lifecycle cleanup:
  - `HLSTech.destroy()` now stops hls.js loading before detach/destroy;
  - pauses the media element, clears callbacks, removes `src`, clears `srcObject`, and calls `load()`.
- Hardened the demo command flow:
  - load/play/stop operations now run through a serialized queue so repeated clicks do not overlap player create/destroy.
- Browser evidence:
  - repeated local MediaMTX HLS reloads stayed at one `video`, zero `audio`, one `fyra-ui-shell`, and `state='playing'`;
  - WebRTC state showed `video.muted=false` and no extra audio element/path, but the MediaStream audio track remained `muted=true` with zero decoded audio bytes.
- Interpretation:
  - the WebRTC silent-audio state is no longer explained by player mute controls;
  - with OBS RTMP publishing, HLS audio can work while WebRTC audio remains muted because the WebRTC browser path expects codecs such as Opus, whereas RTMP output is commonly AAC-oriented. Validate WebRTC audio with an Opus-capable MediaMTX ingest path.

Validation:

- `pnpm exec jest tests/webrtc-tech-stats.test.ts tests/hls-dash-events.test.ts --runInBand`: passed, 2 suites / 11 tests.
- `pnpm bundle:examples`: passed.
- Chrome browser run on `http://127.0.0.1:4185/basic.html`: local MediaMTX HLS repeated reload and WHEP audio diagnostics recorded in `docs/playback-verification-matrix.md`.

Remaining:

- Re-test MediaMTX WHEP audio using an Opus-capable publish path, such as MediaMTX's OBS RTSP/libopus workflow or another WebRTC/WHIP-compatible ingest path.
- Continue `CR-006` interruption/reconnect and `CR-013` long-run profiling evidence.

---

### 2026-05-18 MediaMTX HLS Stability Boundary And Reconnect Pass

Summary:

- Investigated the user-reported symptom where MediaMTX HLS video kept moving forward while audio repeated/layered.
- Follow-up root cause correction: the repeated/layered audio was confirmed as OBS desktop-audio capture feedback. Do not keep treating this symptom as a FyraPlayer, MediaMTX, or hls.js audio defect.
- Confirmed a separate configuration risk that remains valid: hls.js 1.6.x defaults to `lowLatencyMode: true` and `liveSyncMode: 'edge'`, while the MediaMTX normal HLS preset is a source with `lowLatency: false`.
- Added `buildHlsPlaybackConfig()` so `HLSTech` always builds an explicit playback config:
  - normal HLS uses `lowLatencyMode: false`, `liveSyncMode: 'buffered'`, `liveSyncDurationCount: 3`, `liveMaxLatencyDurationCount: 6`, and bounded live buffer;
  - LL-HLS remains opt-in through `source.lowLatency: true` and still uses the existing low-latency bounds.
- Removed player-side hls.js audio remux/gap overrides from this pass, since they were tied to the now-corrected OBS feedback hypothesis. hls.js defaults are retained for audio drift and gap handling.
- Hardened Player reconnect lifecycle:
  - fatal network events no longer mark the active Tech as failed before retry, so transient disconnects can reload the same protocol;
  - failed Tech tracking is reset immediately before reconnect reload;
  - a pending reconnect timer is cleared when the Tech emits `ready`, preventing recovered playback from being reloaded later by a stale timer;
  - if same-source playback becomes healthy and media time advances before the timer fires, the pending reconnect is skipped instead of forcing a reload;
  - switching source also cancels any pending reconnect from the previous source.
- Added regression coverage for both HLS config modes and Player reconnect behavior.
- Ran a short Chrome smoke against the local MediaMTX HLS stream and verified the runtime hls.js config is buffered live, not low-latency edge mode.
- Added an explicit MediaMTX LL-HLS demo preset and source entry so low-latency behavior can be selected and tested separately from normal HLS.

Validation:

- `cmd /c pnpm exec jest tests/hls-config.test.ts tests/player.test.ts --runInBand`: passed.
- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- Chrome smoke on `http://127.0.0.1:4185/basic.html`: MediaMTX normal HLS runtime config had `lowLatencyMode=false`, `liveSyncMode='buffered'`, `targetLatency` around 6 seconds, one `video`, zero extra `audio`, and decoded audio bytes increased from `167758` to `188130`.
- Chrome smoke on the explicit MediaMTX LL-HLS preset: runtime config had `lowLatencyMode=true`, `liveSyncMode='edge'`, `liveSyncDurationCount=1`, `liveMaxLatencyDurationCount=3`, `maxBufferLength=4`, `backBufferLength=0`, reached `playing`, and decoded audio bytes increased from `156062` to `174281`. Browser playback was muted/stopped after the check to avoid OBS desktop-audio feedback.
- Full validation after the final update passed: `cmd /c pnpm check:public-api`, `cmd /c pnpm exec jest --runInBand`, `cmd /c pnpm build`, `cmd /c pnpm bundle:examples`, `cmd /c pnpm check:exports`, `cmd /c pnpm check:sources`, and `git diff --check`.

Remaining:

- For any future repeated/layered audio report, check OBS first: disable/mute `Desktop Audio` or browser `Application Audio Capture`, keep one intended audio source, set monitoring to `Monitor Off`, and avoid playing an audible preview on the same desktop session OBS captures.
- Run a controlled MediaMTX interruption test: stop OBS or MediaMTX, observe `RECONNECT_ATTEMPT`, restart publishing, and verify the same Tech recovers without stale reloads.
- Edge and long-run evidence still remain under `CR-005`, `CR-006`, and `CR-013`.

---

## 8. How To Update This Document

When work is done:

- Change only the relevant row status in the tracking board.
- Add a dated note under Review Log with commands, result, and files touched.
- If a task is intentionally postponed, mark it `deferred` and explain why.
- Do not mark a task `done` without validation evidence.
