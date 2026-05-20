# FyraPlayer Commercial Readiness Roadmap

> Created: 2026-05-16  
> Owner: FyraPlayer maintainers  
> Purpose: keep architecture review findings, priorities, follow-up tasks, and verification history in one durable place.

This document is the long-term tracking baseline for moving FyraPlayer from an internal/vertical integration player toward a commercial-grade player SDK. It is intentionally conservative: a capability is not considered done until it has code, tests or repeatable manual verification, and documented operational boundaries.

---

## 1. Current Position

As of the 2026-05-19 1.0 closure, FyraPlayer is ready to be positioned as a
controlled commercial-baseline player SDK for the scenarios documented in
`docs/supported-scenarios.md` and `docs/release-1.0-readiness.md`.

This is a conservative 1.0 claim:

- Suitable: controlled commercial product integration, documented HLS/DASH/MP4
  playback, ws-raw MSE fallback, optional UI/diagnostics/auth/storage/recording
  plugins, MediaMTX HLS/WHEP deployments with matching evidence, and SDK
  integration through ESM or IIFE.
- Conditional: broader WebRTC deployments, TURN relay, controlled interruption
  recovery, project-specific direct fMP4 streams, GB28181 gateway integrations,
  and external PSV/Cesium/map/panorama bridges.
- Not in 1.0 scope: DRM, subtitles/text tracks, ads/business analytics,
  browser-side recording, full GB28181 server stack, PTZ device execution, and
  unattended rollout across unknown streams/browsers.
- Current commercial baseline is summarized in `docs/supported-scenarios.md`;
  dated evidence is maintained in `docs/playback-verification-matrix.md`.

Historical blockers found on 2026-05-16 are kept in the review log. The build,
test, public API, plugin lifecycle, release, and documentation blockers have
been addressed for 1.0. Browser/runtime matrix expansion and some live-stream
hardening items remain active follow-ups rather than release blockers.

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
| CR-005 | P1 | doing | Test Matrix | Add browser/manual verification matrix for core protocols | Matrix covers Chrome/Edge/Safari where applicable, with stream URLs and expected events. Edge 148 smoke evidence now exists for HLS, HLS fMP4/CMAF, DASH, MP4, MediaMTX HLS on custom port `28888`, MediaMTX WHEP published-stream playback on custom port `28889`, and WHEP 404 handling; Safari/Firefox still need records |
| CR-006 | P1 | doing | WebRTC/Reconnect | Harden session lifecycle, ready/error semantics, reconnect and stats | Chrome + local MediaMTX WHEP startup/stats/destroy-recreate are verified; Player reconnect same-Tech retry and pending timer clearing are unit-covered; optional UI now shows generic stream-interruption/reconnect copy; one real browser ICE disconnected -> reconnect recovery was observed; Edge WHEP server-abnormal-response handling, published-stream playback, and 30-minute WHEP long-run are verified; controlled OBS/MediaMTX stop-start interruption and TURN relay remain pending |
| CR-007 | P1 | done | HLS/DASH | Normalize ready/error/level/stats semantics and HLS live config boundaries | `ready` means playable or explicitly documented; error recovery behavior is tested; normal HLS is explicitly buffered while LL-HLS remains opt-in |
| CR-008 | P1 | done | fMP4 | Add buffer queue backpressure and quota policy | `pendingBuffers` has bounded memory behavior under slow/blocked SourceBuffer, unit coverage verifies overflow and quota cleanup/retry; real-stream evidence remains tracked separately in `CR-020` |
| CR-009 | P1 | done | ws-raw | Decide commercial path for experimental pipeline vs MSE fallback | Default behavior and experimental contract are documented and tested |
| CR-010 | P1 | done | GB28181 | Define server-gateway adapter boundary for invite/bye/ptz/query and standard FLV/TS playback URLs | Unit adapter contract is covered; real backend/device verification remains tracked in `CR-005` |
| CR-011 | P1 | done | Observability | Standardize error codes, network events, metrics, and QoS payloads | Consumers can handle events without parsing console output |
| CR-012 | P1 | done | UI/Plugin | Make UI integration explicit and lifecycle-safe | UI is plugin-only and shell lifecycle cleanup is verified |
| CR-013 | P2 | doing | Performance | Profile WebCodecs/canvas/WebGL render paths | Budget monitor, target thresholds, 30-minute sampling procedure, `pnpm long-run:browser` CDP runner, and `pnpm long-run:assert` report gate are documented. Edge WHEP 30-minute run passed; Edge HLS stayed playable for 30 minutes but strict zero-error assertion failed due to 3 recovered hls.js fatal/reconnect events |
| CR-014 | P2 | done | Docs | Add "known limitations" and "supported scenarios" docs | Users can tell what is stable, experimental, or unsupported |
| CR-015 | P3 | deferred | DRM | Keep DRM as plugin placeholder and Tech adapter design | EME integration can be added without changing core player shape |
| CR-016 | P3 | deferred | Subtitles | Keep subtitles/text-tracks as plugin placeholder | HLS/DASH/native text tracks can be exposed later without blocking core work |
| CR-017 | P1 | done | Plugins | Align plugin boundaries with `docs/pluginization-map.md` | Core/plugin split is documented before new feature work expands |
| CR-018 | P1 | done | Quality/ABR | Expose HLS/DASH quality state and manual/auto selection through public API and UI | `getQualityState()` / `setQualityLevel()` are typed, tested, documented, wired into the optional UI selector, and browser-verified on multi-rendition HLS/DASH |
| CR-019 | P1 | doing | WebRTC Commercial Hardening | Complete Opus audio, ICE recovery, STUN/TURN config, WHEP timeout/error handling, and server-abnormal response evidence | WHEP timeout / non-2xx / answer / ICE-gathering diagnostics, STUN/TURN API docs, unit-covered ICE disconnected/failed semantics, Chrome WHEP audio RTP delivery, one real ICE disconnected recovery, Chrome + Edge WHEP 404 handling, Edge WHEP published-stream playback, and Edge 30-minute WHEP long-run evidence exist; controlled MediaMTX stop-start interruption, TURN relay, and Opus speaker-output validation for the current Edge setup remain pending |
| CR-020 | P1 | doing | fMP4 Real Stream Evidence | Promote direct HTTP/WS fMP4 from conditional only after browser evidence | HTTP direct fMP4 now has a unit-covered non-blocking load/background pump contract and bounded append queue; dated browser evidence exists for a local ffmpeg fixture server, including Chrome manual playback and a 10-minute Edge long-run. Keep collecting project-specific HTTP/WS fMP4 streams before making it a broad core selling point |
| CR-021 | P1 | done | Diagnostics / Debug UX | Convert structured `network`, `qos`, `stats`, player state, source, Tech, retry and ICE clues into product-readable diagnostics | Optional diagnostics plugin exposes snapshot/export callbacks and an optional lightweight panel without core playback coupling |
| CR-022 | P1 | done | Auth / Signing | Add pluginized request signing and token refresh helpers | Middleware helper injects request/signal headers, credentials, tokens, signed URLs, and refreshed headers; recovery plugin refreshes app-owned auth state and reloads current source on explicit 401/403 or custom matcher, with retry/cooldown guards and normalized recovery events |
| CR-023 | P2 | done | Playback Preferences | Expand storage plugin beyond last source | Volume, mute, playback speed, low-latency preference, quality mode, and last source can be persisted with scoped keys and lifecycle cleanup |
| CR-024 | P2 | done | Commercial UI Controls | Move from usable UI plugin toward product-ready controls | Optional UI has generic interruption/reconnect status, retry, quality/source controls, preference events, diagnostics entry hook, screenshot feedback, and recording toggle hook; product-specific visual polish remains app-owned |
| CR-025 | P2 | done | Release / Integration Experience | Prepare SDK consumption assets | ESM/plugin entrypoints, all-in-one CDN/IIFE bundle script, minimal IIFE demo, changelog/release notes, version compatibility policy, migration notes, and release checklist exist in `README.md`, `docs/sdk-release-integration.md`, and `CHANGELOG.md` |
| CR-026 | P2 | done | Render Bridges | Keep PSV/Cesium/map/panorama integrations outside core but documented | `docs/render-bridges.md` defines the external bridge boundary, supported video/canvas/event/metadata outputs, PSV/Cesium ownership, cleanup checklist, and public API smoke covers `CanvasFrameBuffer` / `BaseTarget` |
| CR-027 | P2 | done | Screenshot / Recording | Provide optional capture utilities | UI screenshot feedback exists; backend recording API plugin supports start/stop/status, typed events, normalized errors, and lifecycle cleanup; browser-side recording remains intentionally out of scope |
| CR-028 | P3 | deferred | Ads / Business Analytics | Keep SSAI/CSAI and business event exporters out of current focus | Placeholder exists; not part of current core stabilization work |
| CR-029 | P2 | done for product-demo scope; hardening continues | PanoramaLite | Add lightweight first-party WebGL2 panorama plugin | API/types/export, renderer, image/video texture binding, interaction controls, orientation correction, video upload throttling, canvas pixel caps, unit coverage, demo, and Edge browser smoke evidence for image, MP4/file, HLS VOD, live HLS, and live WebRTC exist. Longer WebGL resource-leak runs, controlled context restore, and deployment-specific orientation validation remain hardening work |

---

## 5. Commercial Readiness Gates

### 1.0 Gate Summary

For `1.0.0`, Gates A and C are closed for the package/release contract. Gate B
is closed only for the scenarios explicitly marked verified in
`docs/supported-scenarios.md`; conditional protocol/browser combinations stay
tracked under `CR-005`, `CR-006`, `CR-013`, `CR-019`, and `CR-020`. Gate D is
implemented for diagnostics, auth/signing, preferences, UI controls, recording
API hook, release integration, and render bridge boundaries, while DRM,
subtitles, ads, and analytics remain deferred.

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

- Diagnostics/debug panel plugin.
- Auth/signing/token refresh plugin.
- Playback preferences plugin expansion.
- Commercial UI controls and capture utilities.
- CDN/IIFE bundle and release notes workflow.
- External render bridges for PSV/Cesium/map/panorama integrations.
- DRM plugin.
- Subtitle/text track plugin.
- Advanced ads and analytics/reporting plugins.
- Enterprise-specific integrations.

---

## 6. Commercial Product Path

The current commercial path is:

1. WebRTC commercial hardening (`CR-019`)
   - Opus-capable audio chain evidence.
   - Browser evidence for ICE `failed` / `disconnected` recovery with MediaMTX
     interruption; the code-level recovery contract is already unit-covered.
   - STUN/TURN relay browser evidence; configuration examples and API
     documentation already exist.
   - WHEP timeout, non-2xx response, malformed SDP, ICE-gathering timeout, and server exception handling evidence.

2. Direct fMP4 evidence (`CR-020`)
   - The project now has unit coverage and bounded backpressure/quota behavior.
   - The user has reported a real direct fMP4 stream can play.
   - Do not promote fMP4 as a commercial selling point until a dated browser record captures the real stream, Tech selection, stats, and 10-30 minute bounded-buffer behavior.
   - If fMP4 is not a headline product capability, keep it `conditional`.

3. Product diagnostics (`CR-021`)
   - Baseline is implemented through `createDiagnosticsPlugin()` and `createDebugPanelPlugin()`.
   - Current surface includes `network.code`, `qos.code`, `stats`, current state, Tech, source, quality, ICE/retry clues, buffer fields, recent events, panel clear, and JSON export.
   - Keep it optional so production apps can disable panel UI while still collecting diagnostics.

4. Commercial stream access (`CR-022`)
   - Baseline is implemented through `createAuthSigningMiddleware()` and `createAuthRecoveryPlugin()`.
   - Request headers, signed URLs, cookies/credentials, token injection, and refreshed headers belong in middleware helpers.
   - Token-expiry recovery is optional and narrow: it defaults to explicit HTTP `401` / `403`, can be customized with `match()`, calls an app-owned `refresh()` hook, and reloads the current source so resolver/auth middleware runs again.
   - Product code still owns token storage, refresh endpoints, cookie policy, and backend-specific expiry semantics.
   - Core should keep only the middleware/request config and public event contracts.

5. Playback preferences and UI (`CR-023`, `CR-024`)
   - Baseline preference persistence is implemented through `createStoragePlugin()`.
   - Persisted fields: volume, muted state, playback speed, low-latency preference, quality mode, and last source.
   - Optional UI now emits preference events and includes a generic error/reconnect status layer with retry action.
   - UI baseline also exposes diagnostics entry, screenshot success/failure feedback, and a recording toggle hook.
   - Rich branded product styling and full recording implementation remain optional product/plugin work.

6. SDK release and integration (`CR-025`, `CR-026`, `CR-027`)
   - SDK release/integration baseline is implemented through ESM exports, plugin subpath exports, all-in-one browser IIFE bundle generation, a minimal IIFE demo, changelog notes, compatibility policy, migration notes, and a release checklist.
   - Render bridge boundary is documented in `docs/render-bridges.md`: FyraPlayer provides video/canvas/event/metadata outputs, while PSV/Cesium/map/panorama adapters remain external.
   - Screenshot feedback stays in the UI shell; backend recording stays in an optional plugin.

7. Deferred product extensions (`CR-015`, `CR-016`, `CR-028`)
   - DRM and subtitles remain plugin placeholders.
   - SSAI/CSAI ads and business analytics exporters are not current priorities.

---

## 7. Deferred Plugin Placeholders

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

## 8. Review Log

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
- Clarified the UI decision: UI is enabled through `createUiComponentsPlugin()` and `PlayerOptions` does not expose a UI configuration field.
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
- Updated `WSRawTech` so only `pipeline: 'experimental'` enables the in-house WebCodecs/WASM pipeline.
- Documented that metadata extraction from TS currently belongs to the experimental demux pipeline, not the stable MSE-only contract.
- Updated README/API docs with the stable vs experimental ws-raw contract.
- Added `tests/ws-raw.tech.test.ts` to lock down default MSE behavior, explicit experimental opt-in, and fallback to MSE after experimental startup failure.
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

- Closed `CR-008` for the code-level fMP4 backpressure/quota policy.
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

- Browser verification for real direct HTTP/WS fMP4 sources is now partially proven in `CR-020` via a local ffmpeg fixture server. The Apple HLS fMP4/CMAF sample only validates HLS Tech, not direct `FMP4Tech`.
- If a project-specific fMP4 source becomes available, record its stream shape and bounded-buffer behavior in `docs/playback-verification-matrix.md` before promoting direct fMP4 beyond the current fixture-backed support claim.

### 2026-05-19 fMP4 HTTP Lifecycle Hardening Pass

Summary:

- Advanced `CR-020` from code-contract-only to dated browser evidence.
- Added a local ffmpeg-backed direct fMP4 fixture server for repeatable browser validation. It serves `fmp4test.mp4` as a looping fragmented MP4 at `/stream.fmp4` and exposes `/healthz`.
- Fixed HTTP direct fMP4 load semantics: after the HTTP response and MSE
  `SourceBuffer` are ready, `FMP4Tech.load()` resolves and pumps the response
  body in the background. Long-lived live responses no longer keep
  `player.init()` / source switching pending until the stream ends.
- Added codec-string overrides to `FMP4Source` so direct fMP4 fixtures can use exact `avc1.4d401f/mp4a.40.2` MIME hints instead of a guessed default.
- Kept existing bounded append queue and quota cleanup behavior intact.
- Added a regression test that uses a never-ending HTTP body and verifies load resolves, `ready` fires, and the first chunk appends through the background pump.

Validation:

- `cmd /c pnpm exec jest tests/fmp4-tech.test.ts --runInBand`: passed, 1 suite / 5 tests.
- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm bundle:examples`: passed.
- Edge direct fMP4 10-minute long-run passed: `pnpm long-run:browser -- --url http://127.0.0.1:3000/basic.html --source-url http://127.0.0.1:18080/stream.fmp4 --source-type fmp4 --duration 10m --interval 10s --out .fyra-long-run\ffmpeg-fmp4-edge-10m.json --fail-on-error --expect-live`. Summary: `tech=fmp4`, `readyState=4`, `960x540`, currentTime `0.001774 -> 599.913408`, 62 samples, 17,981 total / 3 dropped frames, heap +1.53 MiB, DOM stable, 0 error events, 0 fatal network events.

Remaining:

- Direct HTTP/WS fMP4 now has browser evidence for a local ffmpeg-backed fixture. Project-specific stream shapes still need their own records before broader promotion.

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
- Added lifecycle cleanup: metrics plugin now unregisters `stats` and `qos` handlers on destroy.
- Exported the metrics plugin factory from `fyraplayer/plugins` and `fyraplayer/plugins/metrics`.
- Extended `checks/public-api-smoke.ts` for `createMetricsPlugin` and `MetricsPluginOptions`.
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
- Kept `PlayerNetworkEvent.type` as the original Tech event name for debugging; consumers should use `code` for stable business handling.
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
- Added `createReconnectPlugin()` with optional callbacks/logging controls and lifecycle cleanup for `network` / `error` listeners.
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

### 2026-05-18 HLS/DASH Quality Control API Pass

Summary:

- Started `CR-018` for player-facing quality control completeness.
- Added public `QualityLevel` / `QualityState` types and Player methods:
  - `getQualityState()`;
  - `setQualityLevel(level)`, where `level` is a numeric/string level id or `'auto'`.
- Added HLS quality state and selection on top of hls.js levels:
  - exposes level labels, bitrate, dimensions, codec, active state, and ABR mode;
  - setting `'auto'` restores hls.js ABR; numeric selection pins a level.
- Added DASH quality state and selection on top of dash.js representations:
  - exposes video representations with bitrate, dimensions, codec, active state, and ABR mode;
  - setting `'auto'` restores DASH ABR; numeric/string selection disables video ABR and selects a representation by id/index.
- Updated the optional UI plugin so the quality selector prefers Tech-level ABR controls. It falls back to multi-source switching only when the active Tech does not expose adaptive quality levels.
- Added Player-level and HLS/DASH Tech-level regression coverage, and updated the public API smoke contract.
- Fixed the optional UI selector popup contrast by giving native `option` / `optgroup` rows explicit dark text on a white background while keeping the collapsed selector white on the dark control bar.
- Added Chrome browser evidence for real multi-rendition HLS and DASH manual quality selection plus restoring Auto.

Validation:

- `cmd /c pnpm exec jest tests/hls-dash-events.test.ts tests/player.test.ts tests/ui-components.test.ts tests/storage-reconnect-plugin.test.ts --runInBand`: passed, 4 suites / 32 tests.
- `cmd /c pnpm check:public-api`: passed.
- `cmd /c pnpm exec jest --runInBand`: passed, 21 suites / 106 tests.
- `cmd /c pnpm build`: passed.
- `cmd /c pnpm bundle:examples`: passed.
- `cmd /c pnpm check:exports`: passed, verified 22 package export files.
- `cmd /c pnpm check:sources`: passed, verified 17 example sources.
- `git diff --check`: passed.
- Chrome browser run on `http://127.0.0.1:4187/basic.html`: UI quality selector popup `option` style had `color=rgb(17, 24, 39)` and `background=rgb(255, 255, 255)`.
- Chrome browser run on DASH BBB: 6 quality options exposed, manual switch to level 5 set `auto=false/current=5`, restoring Auto set `auto=true`.
- Chrome browser run on Mux HLS: 5 quality options exposed, manual switch to 1080p set `auto=false/current=4`, restoring Auto set `auto=true`.

Result:

- `CR-018` is done for HLS/DASH. WebRTC/OME-style playlist quality, quality persistence, and business-specific quality policies remain pluginized/future work unless a project requires them.

---

### 2026-05-18 Interruption UI And fMP4 HLS Test Source Pass

Summary:

- Added a generic interruption status in the optional UI shell:
  - reconnect attempt: `视频流中断，正在重新连接...`;
  - reconnect exhausted: `视频流中断，请刷新或重试`;
  - generic fatal interruption before retry: `视频流中断，正在尝试恢复...`.
- The wording is intentionally not split by live/VOD yet. HLS/DASH live status is Tech/manifest specific, while only direct `FMP4Source` currently has an explicit `isLive` field. A generic message avoids wrong classification until the public Source/Tech contract grows a stable live-state flag.
- Added `Apple HLS fMP4/CMAF sample` to the demo preset list with:
  - `type: 'hls'`;
  - URL `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8`.
- Clarified that this Apple stream validates HLS playback with fMP4/CMAF segments, not the no-manifest direct `FMP4Tech` path.
- Documented that prior Chrome local-origin testing hit CORS on the Apple sample; CORS should be logged as an environment limitation, not confused with direct fMP4 support.
- Documented 30-minute live-run acceptance as tool-assisted sampling plus manual observation. Manual watching is useful for subjective smoothness/audio, but commercial acceptance requires sampled evidence for memory, media element count, dropped frames, state, and reconnect behavior.
- Added a demo-page sampling helper under `window.fyraLongRun` so manual browser runs can collect 5-10 second JSON samples without a separate automation dependency.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest tests/ui-components.test.ts tests/player.test.ts --runInBand`: passed, 2 suites / 18 tests.
- `pnpm bundle:examples`: passed.
- `pnpm check:sources`: passed, verified 17 example sources.
- Full follow-up verification passed: `pnpm exec jest --runInBand` (21 suites / 106 tests), `pnpm build`, `pnpm check:public-api`, `pnpm check:exports` (22 package export files), and `git diff --check`.

Remaining:

- Controlled MediaMTX interruption evidence still needs a dated run: stop/restart OBS or MediaMTX, verify reconnect events, observe the UI message, and record whether WebRTC recovers without refreshing.
- 30-minute HLS and WebRTC long-run evidence remains under `CR-006` / `CR-013`.

---

### 2026-05-18 Commercial Product Path And Diagnostics Plugin Pass

Summary:

- Consolidated the commercial product path into explicit roadmap items:
  - `CR-019` WebRTC commercial hardening;
  - `CR-020` direct fMP4 real-stream evidence;
  - `CR-021` diagnostics/debug UX;
  - `CR-022` auth/signing/token refresh;
  - `CR-023` playback preferences;
  - `CR-024` commercial UI controls;
  - `CR-025` release/integration experience;
  - `CR-026` external render bridges;
  - `CR-027` screenshot/recording;
  - `CR-028` deferred ads/business analytics.
- Updated `docs/pluginization-map.md` so diagnostics, auth/signing, preferences, capture, and render bridges stay optional rather than core playback requirements.
- Updated `docs/supported-scenarios.md`:
  - direct fMP4 is no longer described as having no user real-stream signal; the user has reported a direct fMP4 stream plays;
  - commercial support still remains conditional until dated browser evidence records the real stream, active Tech, stats, and bounded-buffer behavior;
  - WebRTC broader support still needs TURN/STUN relay, controlled interruption,
    Edge published-stream playback, and long-run evidence. Opus RTP and one ICE
    recovery path were verified later on Chrome; WHEP abnormal-response handling
    is now verified on Chrome and Edge.
- Added `createDiagnosticsPlugin()` as an optional support/QA plugin:
  - captures current state, active Tech, current source/index, quality state;
  - tracks latest `stats`, `network`, `qos`, and `error`;
  - tracks reconnect attempts/exhaustion, ICE state, WebRTC audio-muted clue, buffer level, fMP4 pending queue clues;
  - keeps a bounded recent event history;
  - exposes `snapshot()`, `exportJson()`, and `clear()`.
- Exported diagnostics through both `fyraplayer/plugins/diagnostics` and aggregated `fyraplayer/plugins`.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest tests/diagnostics-plugin.test.ts --runInBand`: passed, 1 suite / 2 tests.
- `pnpm check:public-api`: passed.
- Full follow-up verification passed: `pnpm exec jest --runInBand` (22 suites / 108 tests), `pnpm build`, `pnpm bundle:examples`, `pnpm check:sources` (17 example sources), `pnpm check:exports` (24 package export files), and `git diff --check`.

Remaining:

- Expand the lightweight Debug Panel into a branded product support console only if a product requires it.
- Add deployment-specific auth backend examples only when a real auth service contract exists.
- Record the user's working direct fMP4 stream in `docs/playback-verification-matrix.md`.
- Continue `CR-019` WebRTC Opus/TURN/ICE/WHEP hardening.

---

### 2026-05-18 Debug Panel And Auth Signing Middleware Pass

Summary:

- Completed the `CR-021` baseline by adding a lightweight visual debug panel on top of diagnostics:
  - state, Tech, source, URL, quality, FPS/bitrate, buffer/pending clues;
  - latest network/QoS code, reconnect counters, ICE state, recent event count;
  - JSON export and clear buttons;
  - lifecycle cleanup removes the panel on player/plugin destroy.
- Added `createDebugPanelPlugin()` as a convenience wrapper around `createDiagnosticsPlugin({ panel })`.
- Started `CR-022` with `createAuthSigningMiddleware()`:
  - supports request/signal middleware stages;
  - injects static headers, credentials, bearer or custom token headers, signed URLs, refreshed headers, and token expiry callback;
  - writes the resulting headers/credentials into `source.request`.
- Wired request config into playback paths:
  - HLS hls.js XHR/fetch requests use headers and credentials;
  - direct HTTP fMP4 fetch uses headers and credentials;
  - WebRTC WHEP/WHIP signaling fetch uses headers and credentials;
  - DASH custom headers are passed to dash.js, while credentials need deployment validation before being promised.
- Exported both features through direct plugin subpaths and the aggregated `fyraplayer/plugins` entry.
- Updated API, support, pluginization, roadmap, and verification docs.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest tests/diagnostics-plugin.test.ts tests/auth-plugin.test.ts tests/player.test.ts --runInBand`: passed, 3 suites / 23 tests.
- `pnpm check:public-api`: passed.

Remaining:

- `CR-022` still needed a narrow runtime recovery helper at this point; it was closed later with `createAuthRecoveryPlugin()`.
- `CR-024` diagnostics entry, screenshot feedback, and recording hooks were completed in the later UI hook pass; product-specific visual polish remains app-owned.

---

### 2026-05-18 Playback Preferences And UI Controls Pass

Summary:

- Completed the `CR-023` baseline in `createStoragePlugin()`:
  - keeps the legacy source-index key for backwards compatibility;
  - adds a structured `preferencesKey`;
  - optionally persists and restores source index, volume, muted state, playback speed, quality mode, and low-latency preference;
  - reapplies quality after `ready` and ignores unsupported Techs;
  - keeps all listeners lifecycle-clean on plugin destroy.
- Added a typed `preference` event to the public player event map.
- Updated the optional UI shell so user changes emit preference events for:
  - volume;
  - muted state;
  - playback speed;
  - quality selection;
  - source selection.
- Advanced `CR-024` from todo to doing:
  - added a generic interruption/reconnect status layer;
  - shows network/retry detail when available;
  - exposes a retry button after reconnect exhaustion;
  - moved UI DOM listeners into the existing cleanup tracker to avoid duplicated listeners after reattach.
- Updated API, support, pluginization, roadmap, and verification docs.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest --runTestsByPath tests/ui-components.test.ts tests/storage-reconnect-plugin.test.ts tests/player.test.ts --runInBand`: passed, 3 suites / 24 tests.
- `pnpm check:public-api`: passed.
- Full follow-up validation passed: `pnpm exec jest --runInBand` (23 suites / 114 tests), `pnpm build`, `pnpm bundle:examples`, `pnpm check:exports` (26 package export files), `pnpm check:sources` (17 example sources), and `git diff --check`.

Remaining:

- Full recording remains `CR-027` product/plugin work; the UI hook is not a recorder.
- Preference persistence is local storage only; cross-device/account sync belongs in a product integration plugin.

---

### 2026-05-18 UI Diagnostics Screenshot Recording Hook Pass

Summary:

- Completed the `CR-024` UI baseline:
  - diagnostics button can call product-provided `onDiagnostics`;
  - screenshot button now downloads a PNG, shows success/failure status, and calls `onScreenshot` with `Blob`, dimensions, filename, player, and video;
  - optional recording button calls `onRecordToggle`, updates active UI only after the hook succeeds, and shows failure feedback when the product hook fails;
  - optional diagnostics/recording controls stay hidden when disabled, including after responsive layout changes.
- Exported `UiActionContext`, `UiScreenshotEvent`, and `UiRecordToggleEvent` through `fyraplayer/plugins/ui-components`.
- Updated API, support, pluginization, roadmap, and verification docs.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest --runTestsByPath tests/ui-components.test.ts tests/storage-reconnect-plugin.test.ts tests/player.test.ts --runInBand`: passed, 3 suites / 25 tests.
- `pnpm check:public-api`: passed.
- Full follow-up validation passed: `pnpm exec jest --runInBand` (23 suites / 114 tests), `pnpm build`, `pnpm bundle:examples`, `pnpm check:exports` (26 package export files), `pnpm check:sources` (17 example sources), and `git diff --check`.

Remaining:

- `CR-027` still needs backend-specific recording API documentation, status/error shaping, storage/retention policy, and manual browser validation for the toggle flow.
- Product-specific branded control styling remains application work on top of the optional UI shell.

---

### 2026-05-18 Recording API And WHEP/WHIP Hardening Pass

Summary:

- Added `createRecordingApiPlugin()` as the backend recording control path:
  - start/stop/status HTTP endpoints;
  - typed `recording` bus events and imperative handle;
  - lifecycle cleanup with abortable requests;
  - no browser-side `captureStream()` / `MediaRecorder` implementation.
- Added WebRTC WHEP/WHIP hardening:
  - signaling `timeoutMs`;
  - `iceGatheringTimeoutMs`;
  - normalized `network.code` values for WHEP HTTP failure, signaling timeout, answer SDP failure, and ICE gathering timeout.
- Added a minimal IIFE demo asset for SDK consumption.
- Updated API, support, pluginization, roadmap, and verification docs.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest tests/recording-plugin.test.ts tests/webrtc-signaling.test.ts tests/webrtc-tech-stats.test.ts --runInBand`: passed, 3 suites / 10 tests.
- `pnpm check:public-api`: passed.

Remaining:

- `CR-019` still needs real browser evidence for the new WHEP diagnostics and Opus/TURN/recovery scenarios.
- `CR-027` remains backend recording API only; a browser recorder is intentionally not planned.

---

### 2026-05-18 SDK Release Integration Closure Pass

Summary:

- Closed `CR-025` for the current SDK consumption baseline.
- Added the release/integration entry to `README.md`.
- Expanded `docs/sdk-release-integration.md` with:
  - public package entrypoints;
  - plugin subpath guidance;
  - all-in-one browser IIFE consumption path;
  - release checklist;
  - version policy and migration boundaries.
- Kept conditional protocol/product items separate from the SDK release claim.

Validation:

- `pnpm check:release`: passed, including all Jest suites, public API check, export contract, example-source contract, ESM build, and IIFE bundle generation.
- Browser IIFE smoke on `http://127.0.0.1:4188/examples/minimal-iife.html`: `window.FyraPlayerSDK` exposed `FyraPlayer`, UI, recording API, diagnostics, auth/signing, storage, and performance plugin factories; minimal demo reached `playing`.

Remaining:

- `CR-019` still needs real browser evidence for Opus/TURN/ICE recovery and the new WHEP abnormal-response diagnostics.
- `CR-020` still needs dated direct fMP4 browser evidence before direct fMP4 can be promoted beyond conditional.
- `CR-026` still needed a consolidated render-bridge boundary document at this point; it was closed later with `docs/render-bridges.md`.
- `CR-027` remains backend recording API only; browser-side recording is intentionally out of scope.

---

### 2026-05-18 Recording API Error Contract Closure Pass

Summary:

- Closed `CR-027` for the current non-browser-recording scope.
- Added `RecordingApiError`, `PlayerRecordingCode`, and
  `PlayerRecordingErrorInfo` to make backend recording failures product-readable.
- Normalized recording backend failures into stable codes:
  - `RECORDING_HTTP_ERROR`;
  - `RECORDING_TIMEOUT`;
  - `RECORDING_ABORTED`;
  - `RECORDING_REQUEST_ERROR`;
  - `RECORDING_PARSE_ERROR`;
  - `RECORDING_CONFIG_ERROR`.
- Kept recording as a backend API hook. No browser `MediaRecorder`,
  `captureStream()`, local storage, or retention policy was added.
- Updated API, support, pluginization, roadmap, and verification docs.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest tests/recording-plugin.test.ts --runInBand`: passed, 1 suite / 4 tests.

Remaining:

- Product backends still own storage location, retention policy, audit trail,
  permissions, and exact start/stop/status endpoint semantics.
- Manual UI-to-backend recording validation should be done with the target VMS
  backend when available.

---

### 2026-05-18 Auth Recovery Plugin Closure Pass

Summary:

- Closed `CR-022` for the current commercial stream-access baseline.
- Added `createAuthRecoveryPlugin()` beside `createAuthSigningMiddleware()`:
  - default recovery matcher only treats explicit HTTP `401` / `403` as auth expiry;
  - products can provide a custom `match()` for backend-specific expiry payloads;
  - optional `refresh()` lets the app update token/cookie/signing state before reload;
  - the plugin reloads the current source with `player.switchSource(currentIndex)`, so source resolver and auth/signing middleware run again;
  - retry count, cooldown, in-flight guard, and destroy cleanup prevent recovery storms;
  - recovery emits stable `network.code` values:
    `AUTH_RECOVERY_ATTEMPT`, `AUTH_RECOVERY_SUCCESS`,
    `AUTH_RECOVERY_FAILED`, and `AUTH_RECOVERY_SKIPPED`.
- Updated public API smoke coverage and docs for the direct auth subpath,
  aggregate plugin entry, and IIFE bundle export path.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm exec jest tests/auth-plugin.test.ts --runInBand`: passed, 1 suite / 8 tests.
- `pnpm check:public-api`: passed.
- `pnpm check:exports`: passed, verified 28 package export files.

Remaining:

- Product integrations still own token storage, refresh endpoint semantics,
  cookie policy, signed URL expiry windows, and whether non-HTTP signals should
  be interpreted as auth expiry.
- Add a real backend auth recovery browser/manual evidence row when a target
  service is available.

---

### 2026-05-18 Render Bridge Boundary Closure Pass

Summary:

- Closed `CR-026` for the FyraPlayer package boundary.
- Added `docs/render-bridges.md` as the canonical external renderer contract:
  - FyraPlayer owns playback, Tech selection, reconnect, quality, stats,
    diagnostics, metadata events, and generic video/canvas outputs;
  - PSV, Cesium, map, panorama, GIS, UAV visualization, camera models, and
    WebGL scene management remain external bridge/package responsibilities;
  - documented the supported bridge outputs: `HTMLVideoElement`, player
    events, playback API, metadata events, `CanvasFrameBuffer`, `BaseTarget`,
    and diagnostics snapshots;
  - documented a renderer-agnostic bridge lifecycle pattern and a verification
    checklist for nonblank texture, source switch, cleanup, CORS/canvas, and
    long-run resource checks.
- Kept existing PSV/Cesium/livepano documents as scenario-specific supplements.
- Added public API smoke coverage for `CanvasFrameBuffer` and `BaseTarget` so
  external bridges can rely on those generic helper exports.

Validation:

- `cmd /c pnpm check:public-api`: passed.

Remaining:

- Actual PSV/Cesium/map/panorama bridge implementations and browser evidence
  belong in the owning renderer packages or application repositories.
- Cross-origin canvas/video texture behavior still needs real CDN validation in
  the product environment before renderer support is promised.

---

### 2026-05-18 WebRTC ICE Recovery Contract Pass

Summary:

- Advanced `CR-019` without requiring a live MediaMTX interruption run.
- Hardened WebRTC ICE recovery semantics:
  - `iceConnectionState: "disconnected"` now starts a short recovery grace
    period, calls `restartIce()` when available, then emits fatal
    `WEBRTC_ICE_RECONNECT_REQUIRED` so the player-level reconnect reloads the
    source and renegotiates WHEP/WHIP;
  - `iceConnectionState: "connected"` / `"completed"` cancels the pending
    recovery timer;
  - `iceConnectionState: "failed"` emits fatal `WEBRTC_ICE_FAILED` directly
    and relies on player reconnect instead of pretending local `restartIce()`
    alone can recover one-shot WHEP/WHIP signaling.
- Added public API smoke coverage for WebRTC `iceServers`, `forceRelay`,
  signaling `timeoutMs`, `iceGatheringTimeoutMs`, and WebRTC
  `playoutDelayHintMs`.
- Documented the STUN/TURN, TURN-only relay, and ICE recovery boundary in
  `docs/api.md`.

Validation:

- `cmd /c pnpm exec jest tests/webrtc-tech-stats.test.ts tests/webrtc-signaling.test.ts tests/player.test.ts --runInBand`: passed, 3 suites / 29 tests.
- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm check:public-api`: passed.

Remaining:

- `CR-019` still needs real browser evidence for TURN relay, controlled
  MediaMTX interruption/reconnect, Edge published-stream playback, and
  long-run behavior.
- WHEP/WHIP abnormal-response diagnostics are unit-covered; record a browser
  evidence row when a controllable backend test endpoint is available.

---

### 2026-05-18 Local MediaMTX WHEP Audio And Recovery Evidence

Summary:

- Ran Chrome browser evidence against the user's live MediaMTX endpoint:
  `http://127.0.0.1:8889/live/test/whep`.
- Served FyraPlayer examples from `http://127.0.0.1:4191/basic.html`.
- Kept the browser video muted during the run so playback audio would not be
  captured back into OBS.
- Verified WHEP startup:
  - player reached `ready`;
  - video `readyState=4`, `currentTime=10.002s`, `1280x720`;
  - media element had no error;
  - audio and video tracks were both `live` and `muted=false`.
- Verified browser audio RTP delivery:
  - RTCStats showed inbound audio codec payload `111` with Opus-compatible
    parameters (`minptime=10;useinbandfec=1`);
  - inbound audio packets/bytes were increasing.
- Observed one real browser ICE recovery:
  - ICE entered `disconnected`;
  - player emitted `WEBRTC_ICE_RESTART`,
    `WEBRTC_ICE_RECONNECT_REQUIRED`, then `RECONNECT_ATTEMPT 1/5`;
  - the source reloaded, ICE moved `checking -> connected`, and playback
    recovered to `playing`, `readyState=4`, `currentTime=37.176s`,
    `1280x720`, audio/video tracks `live`, around 30fps, RTT 1ms, packet loss
    0.
- Later clean-tab retry returned MediaMTX `404` / `no stream is available on
  path 'live/test'`. FyraPlayer normalized this as `WEBRTC_WHEP_HTTP_ERROR`,
  retried through the player reconnect policy, and ended with
  `RECONNECT_EXHAUSTED`. This is correct abnormal-response handling, not a
  player regression.

Validation:

- Browser evidence recorded in `docs/playback-verification-matrix.md`.
- `cmd /c pnpm bundle:examples`: passed before the browser run.

Remaining:

- Controlled OBS/MediaMTX stop-start interruption test is still pending because
  this run observed a spontaneous ICE disconnected/reconnect, not a scripted
  publishing interruption.
- TURN relay, Edge published-stream playback, and 30-minute long-run WebRTC
  evidence remain pending.
- Speaker-output listening was intentionally skipped during OBS publishing to
  avoid audio feedback; audio validation here is RTP/track/stat evidence.

---

### 2026-05-19 Edge CDP And PTZ Boundary Pass

Summary:

- Ran Edge 148.0.3967.70 headless CDP smoke tests against the local examples
  page at `http://127.0.0.1:4192/basic.html`.
- Verified Edge playback for:
  - HLS demo through `hls` Tech at `1280x720`, `readyState=4`, 0 dropped
    frames, and no fatal network/error events;
  - Apple HLS fMP4/CMAF sample through `hls` Tech at `768x432`, 24 ABR levels,
    0 dropped frames, and one non-fatal `HLS_WARNING bufferSeekOverHole`;
  - DASH BBB through `dash` Tech at `768x432`, quality state with 5
    representations, 0 dropped frames, and no fatal events;
  - MP4 demo through `file` Tech at `480x270`, 0 dropped frames, and no fatal
    events.
- Verified Edge WHEP abnormal-response handling while MediaMTX reported
  `404 no stream is available on path 'live/test'`:
  `WEBRTC_WHEP_HTTP_ERROR`, `WEBRTC_SIGNAL_ERROR`, and reconnect attempts 1/5
  through 5/5 were emitted. This is not Edge WHEP playback-success evidence.
- Clarified PTZ ownership:
  - `player.control('gb:ptz', payload)` remains a thin player control hook;
  - real PTZ command translation, permissions, state, ONVIF/vendor SDK/GB XML
    handling, and device execution results belong to the backend gateway.

Validation:

- Browser evidence recorded in `docs/playback-verification-matrix.md`.
- Support state updated in `docs/supported-scenarios.md`.
- PTZ boundary updated in `docs/gb28181.md`, `docs/api.md`, and
  `docs/pluginization-map.md`.

Remaining:

- Edge WHEP with an actively published MediaMTX stream still needs a dated
  playback-success row.
- Controlled OBS/MediaMTX stop-start interruption, TURN relay, and 30-minute
  WebRTC long-run evidence remain open under `CR-006`, `CR-013`, and `CR-019`.
- Direct HTTP/WS fMP4 remains `CR-020`; the Apple sample validates HLS with
  fMP4/CMAF segments, not direct `FMP4Tech`.

---

### 2026-05-19 Browser Long-Run Runner Pass

Summary:

- Added `checks/browser-long-run.mjs` and `pnpm long-run:browser`.
- Added `checks/browser-long-run-assert.mjs` and `pnpm long-run:assert` so
  long-run JSON reports can be checked by explicit gates instead of only being
  reviewed manually.
- The runner starts the examples Vite server, launches Edge or Chrome through
  CDP, waits for the demo app to bind controls, selects a preset or loads a
  custom `--source-url` / `--source-type`, drives `window.fyraLongRun`, and
  writes a JSON report under `.fyra-long-run/`.
- The report includes samples, player events, final video state, DOM counts,
  frame counters, memory fields when available, resource-event clues, and a
  summarized pass/fail surface for playable/currentTime/frame/drop/memory/DOM
  checks.
- The assertion tool validates sample count, sampled duration, observed Tech,
  final playable state, media-time advance, fatal/error events, dropped-frame
  ratio, JS heap growth when available, DOM media element growth, and optional
  live end/stall rules.
- `.fyra-long-run/` is ignored by git so long-run artifacts do not get
  committed accidentally.

Validation:

- Smoke command passed on Edge 148 with local MP4:
  `pnpm long-run:browser -- --browser-path "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --source-url "/testvideo/Rec%200017.mp4" --source-type file --duration 8s --interval 2s --out .fyra-long-run\smoke-local-mp4-edge.json --fail-on-error`.
- Result: 6 samples, `file` Tech, `playing`, `readyState=4`, media time
  advanced from 0 to 7.2666s, `1920x1200`, 217 total / 9 dropped frames, DOM
  counts stable, no fatal network or error events.
- The smoke report passed `pnpm long-run:assert` with `--require-tech file`,
  `--min-samples 2`, `--min-current-time-advance-sec 1`, and
  `--max-memory-growth-mb 64`.
- Evidence recorded in `docs/playback-verification-matrix.md`.

Remaining:

- This closes the tool gap for `CR-013`, but not the commercial evidence gap.
  A real 30-minute run against representative HLS/WebRTC/fMP4 streams still
  needs to be recorded before `CR-013` can close.
- MediaMTX WebRTC long-run should use `--expect-live` and a 5 second interval.

### 2026-05-19 Edge MediaMTX Custom-Port Evidence Pass

Summary:

- Verified the user's current MediaMTX custom-port setup:
  - RTMP listener `21935`
  - HLS listener `28888`
  - WebRTC/WHEP listener `28889`
  - API listener `9997`
- MediaMTX API reported `live/test` ready with RTMP source and tracks `H264`
  + `MPEG-4 Audio`.
- Ran Edge 148 headless CDP evidence through `pnpm long-run:browser` and
  `pnpm long-run:assert`.

Validation:

- HLS `http://127.0.0.1:28888/live/test/index.m3u8` passed a 30 second live
  run: 8 samples, `hls` Tech, `playing`, `readyState=4`, `1280x720`,
  currentTime advanced `12.066999 -> 39.770447`, 837 total / 2 dropped frames,
  DOM stable, no error or fatal network events. Assertion passed with
  `--require-tech hls --expect-live --min-samples 6
  --min-current-time-advance-sec 20 --max-memory-growth-mb 64`.
- WHEP `http://127.0.0.1:28889/live/test/whep` passed a 30 second live run:
  8 samples, `webrtc` Tech, ICE `checking -> connected`, `playing`,
  `readyState=4`, `1280x720`, currentTime advanced `0 -> 30.021`, 901 total /
  4 dropped frames, RTT 1ms, packet loss 0, host/UDP candidate path, DOM stable,
  no error or fatal network events. Assertion passed with `--require-tech
  webrtc --expect-live --min-samples 6 --min-current-time-advance-sec 20
  --max-memory-growth-mb 64`.

Boundary:

- The WHEP report emitted `WEBRTC_AUDIO_MUTED`; the active MediaMTX source
  reported `MPEG-4 Audio`. This is recorded as an ingest/transcoding boundary,
  not a playback failure. Opus speaker-output validation remains separate.
- These are 30 second evidence runs. They reduce Edge published-stream risk but
  do not close the 30-minute long-run requirement under `CR-013` / `CR-019`.

### 2026-05-19 Edge MediaMTX 30-Minute Long-Run Pass

Summary:

- Ran concurrent Edge headless CDP 30-minute live checks against the user's
  custom-port MediaMTX setup:
  - HLS `http://127.0.0.1:28888/live/test/index.m3u8`
  - WHEP `http://127.0.0.1:28889/live/test/whep`
- Fixed Player state synchronization from the native `HTMLVideoElement`
  `play` / `playing` / `pause` / `ended` events so diagnostics and long-run
  samples do not remain stuck at `ready` while the video is actually playing.

Validation:

- WHEP passed the strict 30-minute assertion:
  - 362 samples over 1800s;
  - `webrtc` Tech, final `readyState=4`, `1280x720`;
  - currentTime advanced `0 -> 1662.559`;
  - 46512 total / 2663 dropped frames, about 5.73%;
  - heap +0.38 MiB, DOM stable, no public error events;
  - one ICE disconnected/reconnect-required/reconnect-attempt sequence
    recovered without ending playback.
- HLS completed 30 minutes and stayed playable, but did not pass the strict
  zero-error gate:
  - 182 samples over 1800s;
  - `hls` Tech, final `readyState=4`, `1280x720`;
  - currentTime advanced `12.079772 -> 1665.27961`;
  - 48180 total / 490 dropped frames, about 1.02%;
  - heap +5.21 MiB, DOM stable, not ended;
  - 3 hls.js fatal events (`audioTrackLoadTimeOut`, `levelLoadError`) triggered
    3 reconnect attempts and playback recovered.
- Player state sync tests passed:
  `cmd /c pnpm exec jest tests/player.test.ts tests/ui-components.test.ts
  tests/storage-reconnect-plugin.test.ts --runInBand`.
- TypeScript validation passed:
  `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.

Boundary:

- WHEP 30-minute evidence can now be counted under `CR-019`, with TURN,
  controlled stop-start interruption, and current-setup Opus speaker-output
  validation still open.
- HLS long-run is useful recovery evidence, but should remain active until a
  zero-fatal 30-minute run or an intentional hls.js fatal/recovery acceptance
  policy is defined.

---

### 2026-05-19 1.0 Commercial Baseline Closure

Summary:

- Prepared `1.0.0` as the first controlled commercial-baseline release.
- Added `docs/release-1.0-readiness.md` to capture the architecture review,
  included scope, explicit non-scope, evidence summary, release gate, and
  post-1.0 follow-up list.
- Updated README, API docs, supported-scenarios, SDK release docs, changelog,
  performance baseline, and review-alignment docs so release claims match the
  implementation and evidence.

Release boundary:

- 1.0 is acceptable for controlled product integration against the verified
  support matrix.
- 1.0 is not a promise of unconditional support for every browser, protocol,
  backend, and stream shape.
- Remaining live-stream evidence items stay active under `CR-005`, `CR-006`,
  `CR-013`, `CR-019`, and `CR-020`.

Post-1.0 focus:

- WebRTC TURN relay, controlled MediaMTX interruption/reconnect, and current
  Edge Opus speaker-output evidence.
- HLS 30-minute zero-fatal retest or a documented recovered-fatal acceptance
  policy.
- Safari/Firefox verification rows.
- Project-specific direct HTTP/WS fMP4 evidence.
- Real backend evidence for auth recovery and recording API integration.

---

### 2026-05-19 Example And Compatibility Cleanup Pass

Summary:

- Removed stale standalone examples that were outside the 1.0 supported
  integration path:
  - old HLS direct/debug pages with hard-coded local LL-HLS URLs;
  - placeholder PSV/Cesium HTML demos that mocked external renderer adapters;
  - duplicate KLV TypeScript sample that imported from `../src` and used the
    deprecated `experimental: true` source flag.
- Kept `examples/basic.html`, `examples/app.ts`, `examples/sources.js`, and
  `examples/minimal-iife.html` as the supported example set.

Clean API decision:

- Removed pre-release compatibility surfaces before the first formal release:
  `fyraplayer/plugins/recording`, `HLSDASHTech`, `LegacyTechName`,
  `WSRawSource.experimental`, `PlayerOptions.ui`, `UiShellElements`,
  `metricsPlugin`, `storagePlugin`, and `reconnectPlugin`.
- The supported 1.0 surface now keeps a single public path for each feature:
  `fyraplayer/plugins/recording-api`, `HLSTech`, `pipeline: 'experimental'`,
  `createMetricsPlugin()`, `createStoragePlugin()`, and
  `createReconnectPlugin()`.
- Validation after the clean API pass:
  - `cmd /c pnpm check:public-api`: passed.
  - `cmd /c pnpm exec jest tests/ws-raw.tech.test.ts tests/metrics-plugin.test.ts tests/storage-reconnect-plugin.test.ts --runInBand`: passed, 3 suites / 10 tests.
  - `cmd /c pnpm check:release`: passed, including 25 Jest suites / 128 tests, 28 package export files, and 18 example sources.
  - `cmd /c pnpm bundle:examples`: passed.
  - `git diff --check`: passed.

---

### 2026-05-19 PanoramaLite Baseline Implementation

Summary:

- Added the first-party optional `panoramalite` plugin as a lightweight WebGL2
  equirectangular renderer for panoramic images, panoramic video, and future
  live panorama sources.
- Added `PlayerAPI.getVideoElement()` for renderer plugins and host
  integrations that need the player-owned media element without accessing
  private state.
- Exposed `fyraplayer/plugins/panoramalite`, the aggregate `fyraplayer/plugins`
  export, and the IIFE export surface.
- Implemented math/camera/sphere mesh, video/image texture binding, pointer /
  touch / wheel controls, WebGL2 unsupported diagnostics, context
  loss/restoration hooks, and lifecycle cleanup.
- Updated API, SDK integration, pluginization, supported-scenarios, and
  PanoramaLite tracking docs. Product support claims remain conditional until
  browser pixel evidence is recorded.

Validation:

- `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed, 7
  tests.
- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm check:release`: passed, including 26 Jest suites / 135 tests,
  public API check, 30 package export files, 18 example sources, ESM build, and
  IIFE bundle.

Remaining:

- Add a runnable PanoramaLite example/demo preset.
- Record browser pixel evidence for panoramic image, MP4/file video, HLS 360,
  and live/WebRTC or MediaMTX sources before marking `CR-029` done.

---

### 2026-05-19 PanoramaLite Browser Smoke Pass

Summary:

- Added `examples/panoramalite.html` and the `pnpm smoke:panoramalite` CDP
  smoke runner.
- Added browser-readable PanoramaLite smoke assertions for nonblank WebGL
  canvas pixels, pointer-drag view/pixel changes, video readiness, and destroy
  cleanup.
- Added media-element event scheduling to PanoramaLite after an initial HLS
  smoke showed video playback could be ready while the first canvas sample
  stayed black.
- Added `crossOrigin` and `preserveDrawingBuffer` options for integration and
  automation use cases.

Validation:

- `cmd /c pnpm smoke:panoramalite -- --scenario image --duration 2s --out .fyra-long-run\panoramalite-image-edge.json --fail-on-error`: passed.
- `cmd /c pnpm smoke:panoramalite -- --scenario file --source-url /testvideo/Rec%200017.mp4 --duration 6s --out .fyra-long-run\panoramalite-file-local-edge.json --fail-on-error`: passed.
- `cmd /c pnpm smoke:panoramalite -- --scenario hls --source-url https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8 --duration 8s --out .fyra-long-run\panoramalite-hls-demo-edge.json --fail-on-error`: passed.

Additional live validation:

- After OBS started publishing to MediaMTX `live/test`, MediaMTX API reported
  the path ready and the HLS playlist returned 200.
- `cmd /c pnpm smoke:panoramalite -- --scenario hls --source-url http://127.0.0.1:28888/live/test/index.m3u8 --duration 20s --out .fyra-long-run\panoramalite-hls-live-edge.json --fail-on-error`: passed.
- `cmd /c pnpm smoke:panoramalite -- --scenario webrtc --source-url http://127.0.0.1:28889/live/test/whep --duration 8s --out .fyra-long-run\panoramalite-webrtc-live-edge.json --fail-on-error`: passed.
- `CR-029` is closed for smoke/product-demo scope. Longer WebGL resource-leak
  or 30-minute panorama-specific runs can be tracked as a separate hardening
  item if needed.

---

### 2026-05-19 PanoramaLite Orientation And Performance Hardening

Summary:

- Added a generated equirectangular latitude/longitude calibration grid as the
  default PanoramaLite demo source. It exposes equator, front meridian, up/down,
  left/right, and back labels so inverted or mirrored video can be confirmed
  visually before changing integration config.
- Added public `textureFlipX` and `textureFlipY` options and moved orientation
  correction into shader texture-coordinate transforms. WebGL upload now keeps
  `UNPACK_FLIP_Y_WEBGL` disabled by default.
- Added `maxVideoFps` and `maxCanvasPixels` as explicit fallback controls for
  live panorama performance. The renderer already rasterizes only the visible
  canvas pixels; the practical optimization target is full-frame video texture
  upload and high-DPI backing-store size.
- Earlier live smoke used conservative demo caps for quick stability proof.
  Current SDK/demo defaults preserve quality; upload/frame/canvas caps are
  opt-in fallbacks for constrained clients or dense monitoring layouts.

Validation:

- `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed, 8
  tests.
- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.

---

### 2026-05-19 PanoramaLite Default Quality Scheduling Pass

Summary:

- Separated default `textureFlipY` behavior by media type. Generated panorama
  images defaulted to Y-flipped shader coordinates in this pass; this was later
  corrected because the generated grid must be the zero-flip calibration
  baseline. Video/WebRTC/HLS sources defaulted to neutral Y orientation.
  Explicit `textureFlipY` still overrides for camera-specific integrations.
- Removed normal demo defaults that capped `maxPixelRatio`, `maxCanvasPixels`,
  and `maxVideoFps`. The demo now keeps full quality unless the integrator
  explicitly opts into those fallback knobs.
- Scoped `preserveDrawingBuffer` to `?smoke=1` automation mode because it is
  useful for pixel readback but can add GPU synchronization cost in normal
  playback.
- Added non-degrading render-loop hardening: duplicate frame skipping via
  `requestVideoFrameCallback` metadata, dirty-frame texture uploads,
  RAF-coalesced rendering, `ResizeObserver` dirty resize, cached WebGL texture
  limits, and default `powerPreference: 'high-performance'`.

Validation:

- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed, 10
  tests.
- `cmd /c pnpm smoke:panoramalite -- --scenario image --duration 2s --out .fyra-long-run\panoramalite-grid-image-orientation-default-quality-edge.json --fail-on-error`: passed.
- `cmd /c pnpm smoke:panoramalite -- --port 4201 --scenario hls --source-url http://127.0.0.1:28888/live/test/index.m3u8 --duration 12s --out .fyra-long-run\panoramalite-hls-live-default-quality-edge.json --fail-on-error`: passed.
- `cmd /c pnpm smoke:panoramalite -- --port 4202 --scenario webrtc --source-url http://127.0.0.1:28889/live/test/whep --duration 10s --out .fyra-long-run\panoramalite-webrtc-live-default-quality-edge.json --fail-on-error`: passed.

---

### 2026-05-20 PanoramaLite Viewer Controls And Orientation Pass

Summary:

- Changed the video-source `textureFlipX` default to `true` so PanoramaLite
  video matches the ordinary FyraPlayer/video-element left/right orientation.
  This fixes the observed need to click Flip X manually for live/video sources.
- Kept image-source `textureFlipX` default `false`; image-source vertical
  orientation was still `textureFlipY: true` in this pass, then corrected in
  the image-baseline follow-up.
- Added optional `viewerControls`, disabled by default for SDK purity and
  enabled in the PanoramaLite demo. The overlay provides in-view play/pause,
  seek for finite media, loop, mute/volume, reset view, and fullscreen controls.
- Refined the overlay style to a lightweight bottom floating control cluster
  instead of a full-width dark bar, reducing panorama occlusion. Live mode hides
  seek, loop, the live label, and the volume slider while retaining essential
  buttons.
- Routed viewer-control play/pause through the FyraPlayer `PlayerAPI`, and
  exported `PanoramaLiteViewerControlsOptions` from public plugin entry points.
- Viewer controls are intentionally a lightweight plugin-level affordance for
  fullscreen/touch usage; richer branded controls, WebXR presentation,
  keyboard/focus polish, and mobile safe-area polish remain follow-up work.

Validation:

- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed, 11
  tests.
- `cmd /c pnpm smoke:panoramalite -- --port 4224 --scenario image --duration 3s --out .fyra-long-run\panoramalite-viewer-controls-image-edge-20260520-retry.json --fail-on-error`: passed after one concurrent automation timeout.
- `cmd /c pnpm smoke:panoramalite -- --port 4221 --scenario hls --source-url http://127.0.0.1:28888/live/test/index.m3u8 --duration 12s --out .fyra-long-run\panoramalite-hls-video-x-default-edge-20260520.json --fail-on-error`: passed.
- `cmd /c pnpm smoke:panoramalite -- --port 4225 --scenario webrtc --source-url http://127.0.0.1:28889/live/test/whep --duration 10s --out .fyra-long-run\panoramalite-webrtc-video-x-default-edge-20260520-retry.json --fail-on-error`: passed after one CDP-only timeout.

---

### 2026-05-20 PanoramaLite Image Baseline Orientation Correction

Summary:

- Corrected image-source defaults to `textureFlipX: false` and
  `textureFlipY: false`.
- Changed the demo so the generated latitude/longitude grid loads with both
  `Flip X` and `Flip Y` unchecked. The generated grid is the calibration
  baseline, not a source that should need default compensation.
- Corrected the sphere mesh U coordinates from mirrored `1 - u` to standard
  equirectangular `u` after browser screenshot review showed the zero-flip grid
  was horizontally mirrored.
- Changed video-source defaults to the same zero-flip baseline:
  `textureFlipX: false` and `textureFlipY: false`; explicit flips remain
  available for deployment-specific camera or encoder exceptions.
- Updated tests and public docs to remove the older image-Y-flip and
  video-X-flip assumptions.

Validation:

- Browser screenshot review on `http://127.0.0.1:4197/panoramalite.html`
  confirmed `Flip X` and `Flip Y` both unchecked with readable `FRONT 0deg`
  and latitude labels.
- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed.
- `cmd /c pnpm smoke:panoramalite -- --port 4230 --scenario image --duration 3s --out .fyra-long-run\panoramalite-image-zero-flip-baseline-edge-20260520.json --fail-on-error`: passed.

---

### 2026-05-20 PanoramaLite Demo Source Refresh And Runtime Mode Guidance

Summary:

- Added Naver equirectangular HLS, Radiant Lac de Bimont HLS, and Electroteque
  Ultra Light Flight HLS to `examples/sources.js` and
  `examples/panoramalite.html`.
- Removed the old Bitmovin Playhouse 360 HLS/MP4/DASH demo defaults and stopped
  using them in the PanoramaLite smoke runner.
- Added a PanoramaLite demo preset selector for generated image, Naver HLS,
  Radiant HLS, MediaMTX HLS, MediaMTX WebRTC, local MP4, and custom URL.
- Added `enabled` / `handle.setEnabled()` runtime mode control so a player that
  was created with PanoramaLite can switch the current video element between
  ordinary playback and panorama rendering without reloading the stream.
- Added a demo plugin-status panel that reports configured plugins, active
  plugin state, and current ordinary/panorama mode.
- Documented the interaction boundary: current PanoramaLite is screen-oriented
  yaw/pitch/fov playback with stable horizon and default roll lock;
  gyro/device-orientation and headset/WebXR behavior remain future opt-in
  modes/plugins.
- Clarified the product design: plugin availability should be set by
  deployment/config; the product UI can show installed plugins and expose safe
  runtime modes, but arbitrary plugin installation should not be an end-user
  setting in the player surface.

Validation:

- `cmd /c pnpm check:sources`: passed, 17 example sources.
- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed.
- `cmd /c pnpm check:release`: passed, 26 suites / 141 tests plus public API, exports, source contract, and IIFE bundle.
- `cmd /c pnpm smoke:panoramalite -- --port 4233 --scenario hls --source-url https://naver.github.io/egjs-view360/pano/equirect/m3u8/equi.m3u8 --duration 8s --out .fyra-long-run\panoramalite-hls-naver-equirect-edge-20260520-runtime-mode.json --fail-on-error`: passed.
- `cmd /c pnpm smoke:panoramalite -- --port 4234 --scenario hls --source-url https://cdn.radiantmediatechs.com/rmp/media/samples-for-rmp-site/04052024-lac-de-bimont/hls/playlist.m3u8 --duration 8s --out .fyra-long-run\panoramalite-hls-radiant-lac-de-bimont-edge-20260520-runtime-mode.json --fail-on-error`: passed.
- `cmd /c pnpm smoke:panoramalite -- --port 4235 --scenario hls --source-url https://videos.electroteque.org/360/hls/ultra_light_flight.m3u8 --duration 8s --out .fyra-long-run\panoramalite-hls-electroteque-ultra-light-flight-edge-20260520.json --fail-on-error`: passed.
- Playwright manual check on `http://127.0.0.1:4240/panoramalite.html` confirmed the Plugins panel and Panorama runtime toggle update active/mode state without reloading the source.

---

### 2026-05-20 PanoramaLite Z-Axis Roll Boundary Cleanup

Summary:

- Removed the temporary visible Z-axis locking switch and related public handle
  methods after product review. Screen interaction already does not write roll,
  and the locking approach would not solve camera/projection visual tilt.
- Kept `PanoramaLiteView.roll` and programmatic `setView({ roll })` available
  for future gyro, WebXR, or product-owned orientation integrations.
- Kept the demo roll value readout for diagnostics while removing the locking
  control from the user surface.
- Updated smoke automation to assert that pointer drag changes view/pixels
  while keeping roll stable during normal screen interaction.

Validation:

- `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed,
  14 tests.
- `cmd /c pnpm check:public-api`: passed.
- `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `cmd /c pnpm check:sources`: passed, 18 example sources.
- `cmd /c pnpm bundle:examples`: passed.
- `git diff --check`: passed.
- `cmd /c pnpm check:release`: passed, 26 suites / 142 tests plus public API,
  exports, source contract, and IIFE bundle.
- `cmd /c pnpm smoke:panoramalite -- --port 4242 --scenario image --duration 3s --out .fyra-long-run\panoramalite-screen-roll-stable-image-edge-20260520.json --fail-on-error`: passed with `rollStableAfterDrag: true`.
- Playwright check on `http://127.0.0.1:4240/panoramalite.html` confirmed
  the Z-axis locking switch is absent, the status shows `roll 0.0`, and
  pointer drag changed `yaw/pitch` while `rollDelta = 0`.

---

### 2026-05-20 Unified Basic Demo For PanoramaLite

Summary:

- Merged the ordinary player and PanoramaLite product-demo behavior into
  `examples/basic.html` / `examples/app.ts`.
- `examples/sources.js` panorama entries now flow into the main source
  selector with a `[全景]` prefix instead of living only in the focused
  PanoramaLite demo.
- Selecting a panorama source automatically enables PanoramaLite mode. Manual
  runtime switching is also available through the `全景模式` toggle and
  `window.fyraPanorama`.
- In ordinary mode the UI plugin shell remains visible. In panorama mode the
  normal UI shell is hidden and PanoramaLite viewer controls become the visible
  playback/fullscreen surface. Native controls stay hidden in panorama mode.
- Panorama status and plugin status are shown in the main demo so QA can verify
  configured plugins, active mode, and texture flip state without opening the
  console.

Validation:

- `pnpm bundle:examples`: passed.
- `pnpm check:sources`: passed, 18 example sources.
- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm check:public-api`: passed.
- `pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed,
  14 tests.
- `git diff --check`: passed.
- `pnpm check:release`: passed, 26 suites / 142 tests plus public API,
  exports, source contract, and IIFE bundle.
- Playwright on `http://127.0.0.1:4246/basic.html`: passed for source-list
  structure, Naver panorama source auto-enable, UI-shell replacement,
  PanoramaLite canvas/handle activation, and ordinary UI restoration after
  disabling panorama mode.

---

### 2026-05-20 Source Metadata Trigger For PanoramaLite

Summary:

- Promoted panorama activation from demo-local `panorama: true` to a formal
  source metadata contract:
  - `source.presentation.mode = 'panorama'`;
  - optional `source.presentation.projection = 'equirectangular'`;
  - optional `source.presentation.renderer = 'panoramalite'`;
  - optional `source.presentation.textureFlipX/Y`;
  - optional `source.tags` / `source.meta.presentation` for upstream platform
    API shapes.
- Added public helpers `getSourcePresentation()` and `isPanoramaSource()` so
  apps can turn a video-source platform tag into UI mode activation without
  parsing URL names or waiting for frame-level metadata.
- Updated the main demo and `examples/sources.js` to use the formal
  presentation metadata for public panorama HLS presets while still accepting
  older demo-only `panorama: true` as an inference path.
- Updated source resolver middleware so `auto` sources keep presentation
  metadata after being converted into concrete fallback sources.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest tests/source-presentation.test.ts tests/source-resolver.test.ts --runInBand`: passed.
- `pnpm exec jest tests/source-presentation.test.ts tests/source-resolver.test.ts tests/panoramalite.test.ts --runInBand`: passed, 24 tests.
- `pnpm check:sources`: passed, 18 example sources.
- `pnpm check:public-api`: passed.
- `pnpm bundle:examples`: passed.
- `pnpm check:release`: passed, 27 suites / 145 tests plus public API,
  exports, source contract, and IIFE bundle.
- Playwright on `http://127.0.0.1:4247/basic.html`: Naver `[全景]`
  preset exposed `presentation.mode = 'panorama'` and `tags: ['panorama']`
  through `player.getCurrentSource()`, checked the panorama toggle, enabled
  the PanoramaLite handle/canvas, and hid the ordinary UI shell.

---

### 2026-05-20 Dependency Version Iteration

Summary:

- Upgraded core playback libraries to the latest compatible patch baseline:
  `hls.js` `^1.6.16` and `dashjs` `^5.1.1`.
- Upgraded the current build/test toolchain:
  `vite` `^8.0.13`, `esbuild` `^0.28.0`, `jest` `^30.4.2`,
  `ts-jest` `^29.4.10`, `@types/jest` `^30.0.0`, `typescript` `^5.9.3`,
  `fast-check` `^4.8.0`, and `@types/node` `^20.19.41`.
- Added `unrs-resolver` to `pnpm-workspace.yaml` `allowBuilds` because Jest 30
  pulls it through the resolver stack.
- Vue was not upgraded or introduced because FyraPlayer currently has no Vue
  runtime/build dependency.
- `mp4box` remains on `^0.5.4` in this pass. Its 2.x upgrade should be handled
  as a separate compatibility pass for the WebCodecs/fMP4 path.
- `mpegts.js` remains on `^1.8.0`; dependency installation can still need
  access to the upstream `xqq/webworkify-webpack` GitHub tarball, so replacing
  or vendoring that path is a separate supply-chain hardening task.

Validation:

- `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
- `pnpm exec jest --runInBand`: passed, 27 suites / 145 tests.
- `pnpm bundle:examples`: passed.

---

## 9. How To Update This Document

When work is done:

- Change only the relevant row status in the tracking board.
- Add a dated note under Review Log with commands, result, and files touched.
- If a task is intentionally postponed, mark it `deferred` and explain why.
- Do not mark a task `done` without validation evidence.
