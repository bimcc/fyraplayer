# Changelog

All notable changes to FyraPlayer will be recorded here.

## 1.1.0-rc.1 - 2026-10-14

Release candidate for controlled integration; this entry does not assert registry publication.
See [release scope, migration and limits](RELEASE_NOTES.md).

### Playback and lifecycle

- Serialize source loads, ignore obsolete completions, preserve same-Tech fallback URLs,
  and expose actual playback sessions and timeline epochs.
- Add reusable stop(), cooperative loading cancellation and per-attempt deadlines across
  middleware, loaders, WebRTC signaling, direct fMP4 and legacy GB startup.
- Add optional plugin lifecycle scopes, setup rollback, reverse cleanup and onPluginError;
  invalidate asynchronous metadata, frame clocks and snapshots when sessions change.
- Correct MTS/FLV routing, MSE startup failures, private PES reassembly and original TS PTS;
  keep KLV/MISB parsing and synchronization in the independent fyraklv package.

### Controls and optional capabilities

- Unify normal/panorama SVG controls, add ordinary loop playback, hide unsupported or
  single-level quality selectors, and protect cross-origin panorama transitions.
- Add touch layouts, inline playback, page fullscreen fallback, gestures and keyboard focus
  isolation for multiple players.
- Add snapshot, frame-clock, playback-health and GB gateway adapter plugin entries.
- Add experimental WebTransport + WebCodecs with a single fyra-media format, optional raw
  metadata, original microsecond frame clocks, bounded queues and explicit fallback Sources.
  Preserve decoder warmup keyframes instead of resetting repeatedly before first output.
- Add application-owned four-player monitoring and fyraklv integration examples; these are
  not extra SDK exports or capacity/synchronization guarantees.

### Packaging and validation

- Add lifecycle/demux/protocol regressions, coverage gates, NodeNext/Bundler tarball consumers,
  plugin dependency checks and Linux/Windows CI configuration.
- Add a reproducible local release-candidate command, version/notes/tag validation, frozen
  tarball checksums and exact-tarball IIFE browser acceptance. Prereleases default to next.
- Ship MIT licensing, third-party notices, DASH bundle notices and the Apache 2.0 text.
- Unify examples on Vite; remove unused fast-check, obsolete declarations, orphan assets and
  tracked generated/local files. Archive old designs while preserving valid tests and evidence.

### Known limits

- WebTransport remains video-only and experimental; HEVC and mobile/browser behavior depend
  on the device. Local four-session tests do not establish capacity or a latency SLA.
- Physical mobile devices, Safari/Firefox parity, several protocol long-runs, TURN/audio and
  screen/telemetry sync remain explicit follow-ups. Legacy experimental Tech cancellation is
  not complete. DRM, subtitles and browser-local recording remain outside this candidate.

## 1.0.2 - Published baseline notes

The following dependency and DASH changes were already present in the published 1.0.2 package,
whose changelog still labelled them Unreleased. They are retained here as baseline history.

- Upgraded playback and build/test dependencies: `hls.js` to `^1.6.16`,
  `dashjs` to `^5.1.1`, `vite` to `^8.0.13`, `esbuild` to `^0.28.0`,
  `jest` to `^30.4.2`, `ts-jest` to `^29.4.10`, `@types/jest` to
  `^30.0.0`, `typescript` to `^5.9.3`.
- Added pnpm build approval for `unrs-resolver`, which is pulled in by the
  Jest 30 resolver stack.
- Moved DASH playback behind the optional `@bimccfyra/fyraplayer/plugins/dash` entry so
  default consumers do not pull dash.js into Vite/Rolldown builds unless DASH is
  explicitly enabled.
- Switched DASH to a runtime-loaded `dist/vendor/dash.all.min.js` path by
  default, with an optional `dashjsLoader` escape hatch for host bundles.
- Exported `@bimccfyra/fyraplayer/vendor/dash.all.min.js` so Vite/Rolldown hosts can
  import it with `?url` and pass the emitted asset URL to
  `createDashTechPlugin({ scriptUrl })`.
- Made `dashjs` and `mp4box` optional peers while keeping them available as dev
  dependencies for the local build/test toolchain.
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
