# Changelog

All notable changes to FyraPlayer will be recorded here.

## Unreleased

- Upgraded playback and build/test dependencies: `hls.js` to `^1.6.16`,
  `dashjs` to `^5.1.1`, `vite` to `^8.0.13`, `esbuild` to `^0.28.0`,
  `jest` to `^30.4.2`, `ts-jest` to `^29.4.10`, `@types/jest` to
  `^30.0.0`, `typescript` to `^5.9.3`, and `fast-check` to `^4.8.0`.
- Added pnpm build approval for `unrs-resolver`, which is pulled in by the
  Jest 30 resolver stack.
- Moved DASH playback behind the optional `fyraplayer/plugins/dash` entry so
  default consumers do not pull dash.js into Vite/Rolldown builds unless DASH is
  explicitly enabled.
- Made MP4Box an optional peer path for the experimental MP4 WebCodecs file
  pipeline via `webCodecs.mp4boxLoader` or a global `MP4Box`.

## 1.0.0 - 2026-05-19

FyraPlayer 1.0.0 is the first commercial baseline release. It is ready for
controlled product integration under the support boundaries documented in
`docs/supported-scenarios.md` and `docs/release-1.0-readiness.md`.

### Added

- Added backend recording API plugin support with typed `recording` events and normalized backend error codes.
- Added WHEP/WHIP signaling timeout, ICE-gathering timeout, HTTP failure, SDP failure, and ICE recovery diagnostics.
- Added an IIFE SDK bundle target and minimal browser integration demo.
- Added commercial UI diagnostics, screenshot feedback, interruption/reconnect copy, quality/source controls, and recording-toggle hooks.
- Added auth/signing middleware and auth recovery plugin support for explicit 401/403 or custom token-expiry recovery.
- Added playback preference persistence for volume, mute, speed, low-latency mode, quality mode, and last source.
- Added diagnostics snapshot/export/debug panel plugin for support and QA workflows.
- Added render bridge boundary documentation for external PSV/Cesium/map/panorama adapters.
- Added browser long-run runner, long-run assertion tool, and ffmpeg-backed direct fMP4 fixture server.
- Added a release self-check command for SDK publishing flows.

### Verified Baseline

- HLS, DASH, MP4, HTTP-FLV/ws-raw MSE path, quality control, plugin lifecycle, public exports, and examples are covered by automated checks and browser evidence.
- Local MediaMTX HLS and WHEP have Chrome/Edge evidence; WHEP has a 30-minute Edge long-run pass.
- Direct no-manifest fMP4 has a local ffmpeg fixture, Chrome smoke evidence, and a 10-minute Edge long-run pass.

### Known Boundaries

- HLS 30-minute MediaMTX evidence stayed playable but is still tracked for a clean zero-fatal retest.
- WebRTC TURN relay, controlled MediaMTX stop-start interruption, and current Edge Opus speaker-output validation remain follow-up items.
- Direct fMP4 is verified on the local fixture; project-specific HTTP/WS fMP4 streams still need their own evidence rows.
- Safari and Firefox parity is not yet complete.
- DRM, subtitles, ads/business analytics, frontend recording, full GB28181 server stack, and concrete PTZ execution are deferred or external/plugin-owned.
