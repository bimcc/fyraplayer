# FyraPlayer 支持场景与已知限制

> Created: 2026-05-17  
> Purpose: make the commercial baseline explicit so product teams know what can be promised today, what is conditional, and what must stay deferred.

This document is the short answer to "what is FyraPlayer actually ready for?".
For `1.0.0`, FyraPlayer is a commercial-baseline SDK for the verified rows
below, with conditional and deferred rows treated as explicit product limits.
For detailed per-browser evidence, use [docs/playback-verification-matrix.md](./playback-verification-matrix.md).

---

## 1. 可对外承诺的基线

These scenarios have code, tests, and repeatable evidence.

| Scenario | Status | Notes |
|---|---|---|
| HLS VOD | Verified | Chrome/Chromium and Edge browser evidence exists; `ready`, `play`, `stats`, and seek behavior are documented. |
| DASH VOD | Verified | Chrome/Chromium and Edge browser evidence exists; `ready`, `play`, `stats`, quality state, and normalized `levelSwitch` payloads are documented. |
| MP4 file playback | Verified | Browser native playback path is stable enough for the current baseline, with Chrome and Edge smoke evidence. |
| HTTP-FLV / ws-raw default path | Verified | The commercial/default path is `pipeline: 'mse'`; it uses mpegts.js + browser MSE. |
| Local MediaMTX HLS | Verified in Chrome and Edge, HLS long-run follow-up active | OBS RTMP -> MediaMTX HLS -> FyraPlayer/hls.js is verified on Chrome with default ports and on Edge with custom port `28888`, `ready`, `play`, `stats`, 1280x720, and about 30 fps. A 30-minute Edge run stayed playable with stable DOM/memory/frame metrics, but strict zero-error assertion failed because hls.js emitted 3 fatal events and the player recovered. HLS teardown now stops hls.js loading and clears the media element before reload. Normal HLS explicitly disables hls.js low-latency edge mode and uses buffered live config; this is covered by unit tests. The reported repeated/layered audio symptom was later confirmed as OBS desktop-audio capture feedback, not a player defect. Controlled interruption and HLS zero-fatal long-run retests remain pending. |
| Local MediaMTX LL-HLS | Chrome smoke verified, conditional | The same MediaMTX HLS URL can be tested with `lowLatency: true` through the explicit LL-HLS demo preset. Chrome smoke reached `playing` with hls.js low-latency config and decoded audio bytes increasing. Keep this separate from the normal HLS support claim because latency/smoothness tradeoffs need longer evidence. |
| Local MediaMTX WebRTC WHEP | Verified in Chrome and Edge, conditional overall | OBS -> MediaMTX WHEP -> FyraPlayer WebRTC is verified on Chrome with ICE connected, `ready`, stats, 1280x720, RTT/packet-loss metrics, clean destroy/recreate, live audio/video tracks, inbound audio RTP, and one observed ICE `disconnected` -> player reconnect -> `connected` recovery. Edge published-stream playback and a 30-minute Edge WHEP long-run are verified on custom port `28889`, and Edge abnormal-response handling is verified for MediaMTX `404 no stream is available`. Player-side forced mute was removed. The latest Edge run still emitted `WEBRTC_AUDIO_MUTED` because the active RTMP source reported `MPEG-4 Audio`; Opus speaker-output success should be validated with an Opus-capable ingest/transcode path. Controlled stop-start interruption and TURN relay remain pending. |
| Playback lifecycle | Verified | `pause -> play`, `seek`, `switchSource`, and `destroy -> recreate` are covered by unit and Chromium evidence. |
| Observability | Verified | Stable `network.code`, `qos.code`, `stats`, and `levelSwitch` payloads are documented and tested. |
| HLS/DASH quality control | Verified in Chrome | Public API and optional UI expose `getQualityState()` / `setQualityLevel()` for HLS/DASH ABR and manual level selection. Chrome browser evidence exists for multi-rendition HLS and DASH manual selection plus restoring Auto; Edge quality-state smoke exists for DASH and Apple HLS fMP4/CMAF, while Edge manual selector, Safari, and Firefox evidence remain pending. |
| Performance budget monitoring | Verified contract | Optional plugin samples `stats`, reports budget violations, and emits `PERFORMANCE_BUDGET` QoS warnings. The CDP long-run runner and JSON assertion gate are available for repeatable evidence capture. Edge WHEP 30-minute profiling passed; Edge direct fMP4 fixture 10-minute profiling passed; Edge HLS 30-minute playback stayed usable but needs a zero-fatal retest. |
| Commercial UI controls | Verified contract | The optional UI shell shows a generic stream-interruption/reconnect message for fatal/reconnect events, includes network/retry detail when available, exposes a retry button after reconnect exhaustion, clears after playback recovers, and keeps the copy intentionally generic instead of live/VOD-specific. It also exposes diagnostics, screenshot, and recording-toggle hooks while leaving product-specific panels and backend recording integration optional. |
| Diagnostics snapshot/export/debug panel | Verified contract | Optional diagnostics plugin can collect current player state, source, Tech, quality, recent `network` / `qos` / `stats` / `error` events, retry counters, ICE clues, export JSON, and render a lightweight support panel. |
| Auth/signing/recovery helpers | Verified contract | Optional helper can inject request/signal headers, credentials, tokens, signed URLs, and refreshed headers. Optional recovery plugin can refresh app-owned auth state and reload the current source on explicit 401/403 or custom expiry matcher. HLS, HTTP fMP4, and WebRTC WHEP/WHIP consume headers/credentials; DASH custom headers are wired, while DASH credentials remain deployment-dependent. |
| Playback preferences | Verified contract | Optional storage plugin can persist source index, volume, muted state, playback speed, quality mode, and low-latency preference. UI controls emit preference events; non-UI integrations can emit the same event from a custom plugin. |
| Screenshot and backend recording hooks | Verified contract | Optional UI can capture screenshots when browser CORS allows it and can expose a recording toggle. Backend recording is handled by `createRecordingApiPlugin()` with start/stop/status calls and structured recording errors; browser-side recording is not implemented. |
| Render bridge boundary | Verified contract | FyraPlayer exports generic video/canvas/event/metadata outputs for external PSV/Cesium/map/panorama adapters. The concrete renderer integrations stay outside this package and need their own browser evidence. |
| UI/plugin lifecycle | Verified | UI is plugin-only; UI, storage, reconnect, metrics, performance, metadata, and third-party Tech plugin cleanup are covered. |

This is the current commercial baseline. Do not expand the promise beyond this set without a new evidence record.

---

## 2. 带条件支持的场景

| Scenario | Current status | Boundary |
|---|---|---|
| HLS with fMP4/CMAF segments | Conditional | The Apple sample is included as an HLS demo preset and exercises hls.js over an `.m3u8` manifest with fMP4/CMAF segments. Edge 148 browser evidence exists with 24 ABR levels and one non-fatal hls.js startup warning. This is not evidence for direct no-manifest `FMP4Tech`; Chrome/Safari evidence still needs separate records. |
| fMP4 direct | Verified on local fixture, conditional for project-specific streams | Queue backpressure, quota cleanup, and non-blocking HTTP live response loading exist. A local ffmpeg-backed fixture server now has Chrome playback plus a 10-minute Edge long-run with `tech=fmp4`, stable DOM, and no fatal events. Keep the support claim conditional for project-specific stream shapes until each one has its own dated browser evidence row. |
| WebRTC / MediaMTX broader support | Conditional | Local Chrome WHEP playback and Edge WHEP published-stream playback evidence exist, and Edge WHEP 404/retry/error normalization is verified. Do not claim broad commercial support until controlled network interruption/reconnect, TURN relay, and 30-minute long-run evidence are recorded. |
| WebRTC Opus/TURN/recovery | Conditional | WHEP video startup is proven. STUN/TURN source configuration is documented and ICE failed/disconnected recovery semantics are unit-covered, including player-level reload after unrecovered `disconnected`. Chrome WHEP audio RTP delivery was observed with payload `111` and live audio track; one real ICE disconnected recovery was observed. Edge server-abnormal-response and published-stream playback are verified. Real TURN relay browser evidence, controlled MediaMTX stop-start interruption recovery, Opus speaker-output validation for the current Edge setup, and long-run evidence remain active commercial-hardening work. |
| GB28181 gateway adapter / PTZ control hook | Conditional | Player-side invite/control/PTZ hook exists for server-side GB gateways. The browser player does not implement SIP/RTP/PS or direct camera control; PTZ command translation, permissions, device state, and execution results belong to the backend gateway. Project-specific backend/device verification is still pending. |
| PanoramaLite first-party WebGL2 renderer | Verified for product-demo scope; hardening continues | `docs/panoramalite.md` defines the lightweight equirectangular image/video/live panorama plugin scope. Edge smoke evidence exists for generated image, MP4/file, HLS VOD, live HLS, and live WebRTC. Video panoramas default to the same left/right orientation as ordinary video playback, images and videos have different default Y-orientation handling, and quality-reducing caps are opt-in fallback knobs. Optional in-view controls support fullscreen/headset-style usage. Long-run WebGL resource sampling, controlled context restore, and deployment-specific orientation validation are still tracked as hardening items. |
| PSV/Cesium/map/panorama bridge implementations | Conditional | The package boundary and generic outputs are documented in `docs/render-bridges.md`. Concrete renderer packages must verify nonblank texture output, cleanup, source switch, metadata sync, CORS/canvas behavior, and long-run resource use in their own environment. |
| ws-raw experimental pipeline | Experimental opt-in | Use only with `pipeline: 'experimental'`. May fall back to MSE. |
| Safari / Edge / Firefox parity | Partial | Edge 148 smoke evidence exists for HLS, HLS fMP4/CMAF, DASH, MP4, MediaMTX HLS, WHEP published-stream playback, WHEP 404 handling, and direct fMP4 fixture playback. Safari/Firefox records still require exact dated runs. |

---

## 3. 已知限制

- DRM/EME is deferred and should stay pluginized.
- Subtitles/text tracks are deferred and should stay pluginized.
- Ads, SSAI/CSAI, analytics exporters, and business workflow modules are not core responsibilities.
- Auth/signing/token refresh, debug panels, preference persistence, screenshots/backend recording, and PSV/Cesium/map/panorama bridges should remain optional plugins/adapters rather than core playback requirements. The current auth helpers cover construction-time middleware composition and a narrow runtime recovery plugin for explicit `401` / `403` or product-provided expiry matchers; token storage, refresh endpoints, cookie policy, and backend-specific expiry semantics remain product/application work. Current preference persistence is storage-plugin based and does not imply cloud account synchronization. Backend recording support means API control only; browser-side local recording is intentionally not part of the support baseline. Renderer bridge support means generic FyraPlayer outputs only; renderer-specific SDKs, projections, GIS layers, and texture lifecycle remain external.
- Long-run memory and listener growth are not yet verified across all browsers and protocols.
- Performance budgets are implemented as warnings and QA signals; they are not yet product-wide optimization proof.
- MediaMTX WebRTC audio validation depends on the ingest/transcoding path. With OBS RTMP publishing, HLS audio may work while WebRTC audio remains muted because browser WebRTC audio expects codecs such as Opus rather than AAC.
- WebRTC ICE `disconnected` / `failed` recovery is covered at the code-contract level. It should not be claimed as field-proven until a dated browser row records controlled MediaMTX interruption and recovery without manual refresh.
- Local MediaMTX HLS should use `lowLatency: false` for the normal `/index.m3u8` preset unless LL-HLS is intentionally being tested. Low-latency mode is still supported, but it should be an explicit source decision because aggressive edge chasing can destabilize audio on normal live streams.
- Repeated or layered audio during local OBS testing should first be treated as an OBS routing issue. The confirmed case was caused by desktop/browser playback audio being captured back into OBS; mute/remove desktop or application capture for the playback app and keep only one intended audio source.
- Unsupported or unverified combinations should be called out explicitly in product docs.

---

## 4. How To Use This

- Use this doc for product-facing support claims.
- Use [docs/playback-verification-matrix.md](./playback-verification-matrix.md) for dated evidence.
- Use [docs/commercial-readiness-roadmap.md](./commercial-readiness-roadmap.md) for task tracking.
- Use [docs/pluginization-map.md](./pluginization-map.md) to decide whether a feature belongs in core or should be optional.
