# FyraPlayer 1.0 Release Readiness Review

> Created: 2026-05-19  
> Purpose: record the final architecture, code, documentation, evidence, and known boundaries before the first 1.0 commercial baseline release.

## 1. Release Conclusion

FyraPlayer can be released as `1.0.0` under a conservative commercial-baseline
positioning:

- It is ready for controlled product integration where the supported scenarios,
  browser targets, stream formats, and backend boundaries are explicitly
  documented.
- It is not a blanket "all protocols, all browsers, all deployments" player
  promise.
- Remaining gaps are tracked and do not require core architecture changes before
  the first 1.0 release.

The product-facing support source of truth is
`docs/supported-scenarios.md`. The dated evidence source of truth is
`docs/playback-verification-matrix.md`.

## 2. Architecture Review

The 1.0 architecture is suitable for long-term extension because optional
product capabilities are kept outside the minimal playback core.

| Layer | Responsibility | 1.0 assessment |
|---|---|---|
| `FyraPlayer` core | Source lifecycle, active Tech selection, middleware execution, reconnect/fallback coordination, event forwarding, public API | Stable enough for 1.0; public API smoke and unit tests cover the main contracts |
| Tech layer | `webrtc`, `hls`, `dash`, `fmp4`, `ws-raw`, `file`, `gb28181` | Broad protocol coverage. HLS/DASH/file/ws-raw MSE are baseline paths; WebRTC and direct fMP4 are supported with documented conditional limits; GB28181 remains a server-gateway adapter |
| Middleware | Request, signal, control, and source resolution extension points | Correct place for auth, signing, source conversion, and gateway adaptation |
| Plugin layer | UI, storage, diagnostics, auth, recording API, performance, metrics, reconnect, metadata, engines, custom Tech registration | Good extension boundary. Product and enterprise features can evolve without inflating core playback |
| UI shell | Optional controls, quality/source selection, reconnect/error UX, screenshot and recording hooks | Product-usable baseline. Branded visual polish and business panels stay app-owned |
| Release assets | ESM exports, plugin subpaths, IIFE bundle, examples, long-run tooling | Suitable for SDK integration and QA repeatability |
| External bridges | PSV/Cesium/map/panorama adapters | Correctly externalized. FyraPlayer provides video/canvas/event/metadata outputs only |

## 3. 1.0 Included Scope

The release includes:

- reproducible build/test/release checks;
- package export contract for core, plugins, and selected helper modules;
- HLS/DASH/file/ws-raw MSE playback baseline;
- HLS/DASH ABR state and manual/auto quality control;
- MediaMTX HLS and WHEP integration evidence;
- WebRTC WHEP/WHIP timeout, HTTP failure, answer, ICE gathering, and ICE
  recovery diagnostics;
- direct fMP4 backpressure/quota handling plus local ffmpeg fixture evidence;
- generic network/QoS/error/stats event semantics;
- optional UI controls with reconnect/error messaging;
- optional diagnostics/debug panel snapshot and JSON export;
- optional auth/signing and token-expiry recovery helpers;
- optional storage preferences;
- backend recording API plugin hook;
- screenshot hook/feedback in the optional UI;
- performance monitor and browser long-run/assert tooling;
- render bridge boundary docs for external PSV/Cesium/map/panorama packages.

## 4. Explicit Non-Scope

These items are intentionally not part of the 1.0 core promise:

- DRM/EME;
- subtitles/text tracks;
- SSAI/CSAI ads and business analytics exporters;
- browser-side frontend recording with `MediaRecorder` / `captureStream()`;
- full GB28181 SIP/RTP/PS stack;
- PTZ command translation/execution against devices;
- concrete PSV/Cesium/map/panorama renderer packages;
- product-specific auth storage, refresh endpoints, permissions, audit trail,
  recording retention, and support-console UX.

They should remain plugins, external packages, or backend responsibilities unless
a future requirement proves they must be part of the minimal playback contract.

## 5. Evidence Summary

Strong enough for 1.0:

- `pnpm check:release` exists and covers Jest, public API, exports, source
  manifests, ESM build, and IIFE bundle generation.
- Edge 148 evidence exists for HLS, HLS fMP4/CMAF, DASH, MP4, MediaMTX HLS,
  MediaMTX WHEP, WHEP 404 handling, and direct fMP4 fixture playback.
- Chrome evidence exists for HLS, DASH, MP4, ws-raw MSE, MediaMTX HLS/WHEP,
  quality control, and direct fMP4 fixture smoke playback.
- Edge WHEP has a 30-minute long-run assertion pass.
- Direct fMP4 has a 10-minute Edge fixture long-run pass.

Still active after 1.0:

- HLS 30-minute MediaMTX zero-fatal retest. The current 30-minute run stayed
  playable and recovered, but strict zero-error assertion failed because hls.js
  emitted three recovered fatal events.
- WebRTC TURN relay evidence.
- Controlled MediaMTX/OBS stop-start interruption and reconnect evidence.
- Opus speaker-output validation for the current Edge setup.
- Project-specific direct HTTP/WS fMP4 streams beyond the local fixture.
- Safari and Firefox browser rows.

## 6. Release Gate

Before pushing or tagging a 1.0 release commit, run:

```bash
pnpm check:release
git diff --check
```

Optional but recommended when MediaMTX/OBS is available:

```bash
pnpm long-run:assert -- .fyra-long-run/mediamtx-whep-28889-edge-30m.json --require-tech webrtc --expect-live --min-samples 300 --min-duration-sec 1740
pnpm long-run:assert -- .fyra-long-run/ffmpeg-fmp4-edge-10m.json --require-tech fmp4 --expect-live --min-samples 50 --min-duration-sec 540
```

The `.fyra-long-run/` reports are local QA artifacts and are intentionally not
committed.

Final local validation on 2026-05-19:

- `cmd /c pnpm check:release`: passed, including 25 Jest suites / 128 tests,
  public API check, export contract (28 package export files), source manifest
  contract (18 example sources), ESM build, and IIFE bundle generation.
- `cmd /c pnpm bundle:examples`: passed.
- `git diff --check`: passed.

Example cleanup after the 1.0 push:

- Removed old standalone HLS debug pages, placeholder PSV/Cesium HTML demos,
  and the duplicate KLV sample because they were not part of the supported SDK
  integration path.
- Kept the supported 1.0 examples focused on `examples/basic.html`,
  `examples/sources.js`, and `examples/minimal-iife.html`.
- Removed pre-release compatibility exports and aliases so the 1.0 API stays
  narrow: use `@bimccfyra/fyraplayer/plugins/recording-api`, `HLSTech`,
  `createStoragePlugin()`, `createReconnectPlugin()`, and
  `createMetricsPlugin()` directly.

## 7. Post-1.0 Work

Priority follow-ups:

1. Finish WebRTC commercial hardening evidence: TURN relay, controlled
   interruption recovery, and current Edge Opus speaker-output validation.
2. Retest HLS 30-minute MediaMTX run for a clean zero-fatal pass or define an
   explicit recovered-fatal acceptance policy.
3. Add Safari/Firefox verification rows for the supported matrix.
4. Collect project-specific direct fMP4 evidence for every non-fixture source
   shape that will be sold as supported.
5. Add real backend evidence for auth recovery and recording API integration
   when the target service is available.
