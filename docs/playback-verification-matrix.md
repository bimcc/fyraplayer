# Playback Verification Matrix

> Created: 2026-05-17  
> Purpose: make real playback verification repeatable across protocols, browsers, and stream backends.

This document is the evidence log for `CR-005`. Unit tests prove code-level behavior; this matrix proves browser playback behavior. Do not mark a protocol/browser combination as passed without a dated run record.

---

## 1. How To Run

1. Start the demo:

```bash
pnpm dev:vite
```

2. Open the demo URL printed by Vite, usually:

```text
http://localhost:3000/
```

3. Select the source from `examples/sources.js` or enter the stream URL manually.
4. Record the browser, OS, source, expected events, actual events, and result in section 6.

For local MediaMTX WebRTC/HLS checks:

```bash
G:\MTX\mediamtx.exe
```

Publish from OBS with:

```text
Server: rtmp://127.0.0.1:1935/live
Stream key: test
```

The expected local playback URLs are:

```text
HLS:    http://127.0.0.1:8888/live/test/index.m3u8
WHEP:   http://127.0.0.1:8889/live/test/whep
RTMP:   rtmp://127.0.0.1:1935/live/test
```

Browser verification should use HLS through FyraPlayer/hls.js and WHEP through `tech-webrtc`; direct browser address-bar playback of `.m3u8` does not prove HLS support.

MediaMTX codec note:

- Browser WebRTC audio should be validated with an ingest path that provides Opus-compatible audio to WebRTC. OBS RTMP commonly publishes AAC audio, which can work through HLS while leaving the browser WebRTC audio track present but muted. MediaMTX documents an OBS WebRTC-readable publishing path through RTSP with H.264 settings and `libopus` audio.
- If FyraPlayer emits `network.code: 'WEBRTC_AUDIO_MUTED'`, first check the MediaMTX/OBS codec path before treating it as a player volume defect.

MediaMTX HLS note:

- Use `lowLatency: false` for the normal HLS URL unless the run is explicitly testing LL-HLS. FyraPlayer forces normal HLS into hls.js buffered live mode (`lowLatencyMode: false`, `liveSyncMode: 'buffered'`) because hls.js 1.6.x defaults to low-latency edge chasing. This avoids treating a normal live stream with separate audio renditions like an LL-HLS stream.
- If audio repeats in a short loop while video moves forward, first verify the runtime hls.js config before tuning server settings. In the demo console, `window.fyraPlayer` exposes the active player; the important evidence is that active HLS config is not in low-latency mode for the normal MediaMTX HLS preset.

---

## 2. Automatic Checks

These checks do not replace browser playback runs, but they keep the verification assets healthy:

```bash
pnpm check:sources
pnpm check:public-api
pnpm check:exports
pnpm test -- --runInBand
```

`pnpm check:sources` validates the structure of `examples/sources.js` so the demo matrix does not silently drift into invalid source definitions.

`createPerformanceMonitorPlugin()` can be enabled during manual runs to record
FPS, latency, pending queue, and buffer-budget warnings. A
`PERFORMANCE_BUDGET` QoS warning is evidence of a breached threshold, not an
automatic protocol failure; include the metric, value, threshold, browser, and
stream when logging it.

---

## 3. Browser Scope

| Browser | Required For | Notes |
|---|---|---|
| Chrome latest | WebRTC, HLS via hls.js, DASH, ws-raw fallback, MP4, UI | Primary commercial validation browser |
| Edge latest | WebRTC, HLS via hls.js, DASH, ws-raw fallback, MP4, UI | Chromium cross-check |
| Safari latest | Native HLS, MP4, basic UI | WebCodecs and MSE behavior may differ; record unsupported features explicitly |
| Firefox latest | HLS via hls.js, DASH, MP4 | WebRTC behavior may require backend-specific signaling checks |

Use exact browser versions in the run log.

---

## 4. Protocol Matrix

| Area | Source | Browser Target | Expected Events | Pass Criteria | Status |
|---|---|---|---|---|---:|
| HLS VOD | `https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8` | Chrome, Edge, Safari | `ready`, `play`, `stats`; no fatal `network` | Starts playback, seek works if VOD duration is exposed | Chrome pass; Edge/Safari pending |
| HLS alternate | `https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8` | Chrome, Edge, Safari | `ready`, `play`, `stats`; no fatal `network` | Starts playback and can recover after pause/play | pending |
| DASH VOD | `https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd` | Chrome, Edge, Firefox | `ready`, `play`, `stats`, optional `levelSwitch` | Starts playback and emits stats within 10 seconds | Chrome pass; Edge/Firefox pending |
| DASH alternate | `https://bitmovin-a.akamaihd.net/content/sintel/sintel.mpd` | Chrome, Edge, Firefox | `ready`, `play`, `stats`; no fatal `network` | Starts playback and pause/play works | pending |
| MP4 file | `https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/mp4/xgplayer-demo-360p.mp4` | Chrome, Edge, Safari, Firefox | `ready`, `play`, `ended` when allowed to finish | Starts playback and seeking works | Chrome pass; Edge/Safari/Firefox pending |
| HTTP-FLV / ws-raw fallback | `https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/flv/xgplayer-demo-360p.flv` | Chrome, Edge | `ready`, `play`, `stats`; no fatal `network` | MSE fallback starts playback; no unbounded error loop | Chrome pass; Edge pending |
| WebRTC WHEP local | `http://127.0.0.1:8889/live/test/whep` | Chrome, Edge | `ready`, `play`, `network`, `stats` | Starts under MediaMTX with a published stream; destroy/recreate is clean; disconnect/reconnect behavior recorded separately | Chrome pass; Edge and interruption pending |
| HLS local MediaMTX | `http://127.0.0.1:8888/live/test/index.m3u8` | Chrome, Edge, Safari | `ready`, `play`, `stats` | Starts under MediaMTX with a published stream; normal HLS uses buffered hls.js live config unless `lowLatency: true` is explicitly selected | Chrome pass; Edge/Safari pending |
| GB28181 gateway adapter | Project-specific invite/control endpoint returning FLV/TS/HLS/WebRTC/fMP4 | Chrome, Edge | `network`, `ready`, control responses | Backend invite returns a browser-playable URL and bye/ptz/query/keepalive behavior is recorded | unit adapter pass; real gateway pending |
| fMP4 direct | Project-specific HTTP/WS fMP4 source | Chrome, Edge | `ready`, `play`, `stats`, no quota errors | Buffer remains bounded for a 10 minute run | unit backpressure pass; real stream pending |

---

## 5. Scenario Checklist

Run these for each stable protocol before promotion:

| Scenario | Expected Result | Status |
|---|---|---:|
| init -> ready -> play | Playback begins or autoplay block is surfaced as non-fatal network/error event | Chrome pass for HLS/DASH/MP4/ws-raw fallback and local MediaMTX HLS/WHEP |
| pause -> play | No duplicate tech load, state returns to playing | Chrome browser pass for HLS; unit pass for Player lifecycle |
| seek for VOD | `currentTime` changes and playback resumes | Chrome browser pass for HLS VOD; unit pass for active Tech delegation |
| switchSource | Previous tech is destroyed; new source reaches ready/play | Chrome browser pass for HLS -> DASH; unit pass for old Tech event isolation |
| destroy -> recreate | DOM/event listeners do not duplicate; UI plugin cleans up | Chrome browser pass for DASH destroy -> HLS recreate and MediaMTX WHEP destroy -> recreate; UI cleanup unit pass |
| network interruption | Fatal event shape is recorded; reconnect/fallback behavior is deterministic | unit pass for pending-timer clearing and same-Tech retry; real MediaMTX interruption pending |
| 30 minute live run | Memory and listener count do not grow unbounded | pending |

---

## 6. Run Log

Append new rows; do not overwrite historical failures.

| Date | Tester | Browser / OS | Source | Scenario | Result | Evidence / Notes |
|---|---|---|---|---|---:|---|
| 2026-05-17 | Codex | Automated Node checks / Windows | `examples/sources.js` | Source structure validation | pass | `pnpm check:sources` |
| 2026-05-17 | Codex | Automated TypeScript/Jest / Windows | package exports + unit tests | API/export/unit verification | pass | `pnpm check:public-api`, `pnpm check:exports`, `pnpm test -- --runInBand` |
| 2026-05-17 | Codex | Jest unit test / Windows | HLS/DASH Tech event contracts | error/ready/levelSwitch semantics | pass | `pnpm test -- tests/hls-dash-events.test.ts --runInBand`; 5 tests covering HLS warning vs fatal mapping, DASH warning vs fatal mapping, ready de-duplication, and stable `levelSwitch` payloads |
| 2026-05-17 | Codex | Automated TypeScript/Jest / Windows | package build + unit tests + public API + source manifest | post-event-contract regression | pass | `pnpm exec jest --runInBand` passed, 11 suites / 40 tests; `pnpm check:public-api` passed; `pnpm build` passed; `pnpm check:sources` passed, 14 sources verified |
| 2026-05-17 | Codex | Documentation contract / Windows | API event docs | HLS/DASH public event semantics | pass | `docs/api.md` now documents tested `ready`, `network`, and `levelSwitch` semantics; `pnpm check:public-api` and `pnpm build` passed after the doc update |
| 2026-05-17 | Codex | Jest unit test / Windows | Player lifecycle | pause/play, seek, switchSource, destroy/recreate | pass | Added regression coverage for active Tech delegation, old Tech event detachment before `switchSource`, and no duplicated forwarding after destroy/recreate; `pnpm exec jest --runInBand` passed, 11 suites / 43 tests |
| 2026-05-17 | Codex | Chromium 148.0.7778.168 / Windows 10 | HLS VOD demo | pause -> play -> seek | pass | Vite demo on `http://127.0.0.1:4173/basic.html`; HLS reached `playing`, `1280x720`; pause state `paused` at 32.30s; resume returned to `playing`; seek target 12.00s resumed at 12.94s; no fatal `error`/`network` events |
| 2026-05-17 | Codex | Chromium 148.0.7778.168 / Windows 10 | HLS VOD -> DASH BBB VOD | switchSource | pass | Source switch from HLS to DASH reached `playing`, current source `dash`, `480x270`, `ready=1`, `play=1`, `levelSwitch=2`, no fatal events |
| 2026-05-17 | Codex | Chromium 148.0.7778.168 / Windows 10 | DASH BBB VOD -> HLS VOD demo | destroy -> recreate | pass | Destroyed DASH player returned old state to `idle`; recreated HLS reached `playing`, current source `hls`, `1280x720`, `ready=1`, `play=1`, `stats=1`, no fatal events |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | HLS VOD demo | init -> ready -> play -> stats | pass | Vite demo on `http://127.0.0.1:4173/basic.html`; reached `playing`, `currentTime=1.90s`, `1280x720`, events: `ready=1`, `play=1`, `stats=2`; hls.js startup buffer events surfaced as non-fatal `network` warnings |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | DASH BBB VOD | init -> ready -> play -> stats -> levelSwitch | pass | Reached `playing`, `currentTime=1.72s`, `480x270`, events: `ready=1`, `play=1`, `stats=1`, `levelSwitch=2`; `levelSwitch` payload normalized to stable small objects |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | MP4 demo | init -> ready -> play -> stats | pass | Reached `playing`, `currentTime=1.96s`, `640x360`, events: `ready=1`, `play=1`, `stats=2` |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | HTTP-FLV / ws-raw fallback demo | init -> ready -> play -> stats | pass | Reached `playing`, `currentTime=1.80s`, `640x360`, events: `ready=1`, `play=1`, `stats=1`; no fatal network loop observed in smoke run |
| 2026-05-17 | Codex | Chromium 148.0.7778.168 / Windows 10 | HTTP-FLV / ws-raw default MSE path | CR-009 stable pipeline contract | pass | Source had no `pipeline` or deprecated `experimental` opt-in, so default path is `pipeline: 'mse'`; reached playable video, `currentTime=1.82s`, `640x360`, `readyState=4`, events: `ready=1`, `stats=2`, no fatal `error`/`network` events |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | DASH BBB VOD | `levelSwitch` payload contract check | pass | `levelSwitch` emitted `{ tech, mediaType, from, to, bitrateKbps, width, height, codec }` instead of dash.js internal MPD/Representation objects |
| 2026-05-17 | Codex | Chromium 148.0.7778.168 / Windows 10 | Demo observability log | `network.code` / `qos.code` visibility | pass | Vite demo on `http://127.0.0.1:4174/basic.html`; demo log showed `qos` with `code: "WEBCODECS_CONFIG"`, `tech: "file"`, `codec: "avc1.640032"` from local MP4 WebCodecs configuration; HLS warning events showed `code: "HLS_WARNING"` for `bufferStalledError` and `bufferSeekOverHole`; controlled WHEP-without-backend failure showed `code: "WEBRTC_SIGNAL_ERROR"` and reconnect follow-up `code: "RECONNECT_ATTEMPT"`. This validates observability event visibility, not MediaMTX/WebRTC playback success. |
| 2026-05-17 | Codex | Jest unit test / Windows | fMP4 Tech direct queue | pending append backpressure and quota cleanup | pass | `pnpm exec jest tests/fmp4-tech.test.ts --runInBand`; verified bounded pending queue, `drop-oldest` overflow, fail-fast `error` strategy, `QuotaExceededError` cleanup/requeue, and retry exhaustion behavior. Real HTTP/WS fMP4 browser stream remains pending because no project-specific fMP4 source is available. |
| 2026-05-17 | Codex | Jest unit test / Windows | GB28181 gateway adapter | invite/control contract and FLV/TS MSE dispatch | pass | `pnpm exec jest tests/gb28181.tech.test.ts --runInBand`; verified invite request/auth config, response mapping, FLV vs TS MSE dispatch, PTZ/BYE/query/keepalive control calls, missing endpoint error, and invite HTTP auth diagnostics. Real GB backend/device verification remains pending. |
| 2026-05-17 | Codex | Jest unit test / Windows | Performance monitor plugin + built-in stats | budget contract and FPS sampling | pass | `pnpm exec jest tests/performance-plugin.test.ts tests/abstract-tech-stats.test.ts --runInBand`; verified normalized samples, cumulative-counter mode, budget violations, `PERFORMANCE_BUDGET` QoS emission, cooldown, teardown, and HTML video FPS delta sampling. Real long-run browser profiling remains pending. |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | MediaMTX HLS local `http://127.0.0.1:8888/live/test/index.m3u8` | OBS RTMP -> MediaMTX HLS -> FyraPlayer/hls.js | pass | OBS published to `rtmp://127.0.0.1:1935/live` with stream key `test`; Vite demo on `http://127.0.0.1:4185/basic.html`; HLS playlist, init segments, and media parts returned 200; reached `ready`, `play`, `stats`, `1280x720`, about 2 Mbps and about 30 fps after user play; non-fatal hls.js startup warnings were recorded as `HLS_WARNING`. |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | MediaMTX WebRTC WHEP local `http://127.0.0.1:8889/live/test/whep` | OBS RTMP -> MediaMTX WHEP -> FyraPlayer WebRTC | pass | WHEP POST returned 201; ICE reached `checking -> connected`; playback reached `readyState=4`, `currentTime=10.627s`, `1280x720`; events included `ready=1`, `stats` with `bitrateKbps=2365`, `fps=30`, `rttMs=1`, `packetLoss=0`, `candidateType='host'`, `transport='udp'`; no fatal `network` events. |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | MediaMTX WebRTC WHEP local `http://127.0.0.1:8889/live/test/whep` | destroy -> recreate | pass | Two sequential WHEP loads after player destroy both reached `readyState=4`, `1280x720`, `readyCount=1`, `errorCount=0`, `videoErrorNetworkCount=0`, `fatalNetworkCount=0`; second run reported `fps=28`, `rttMs=1`, `packetLoss=0`, no public empty-source video error after cleanup fix. |
| 2026-05-17 | Codex | Jest unit test / Windows | WebRTC Tech stats + cleanup | MediaMTX validation regression coverage | pass | `pnpm exec jest tests/webrtc-tech-stats.test.ts --runInBand`; verified RTC stats fall back to video element dimensions, `ready` de-duplication, and cleanup of video callbacks/srcObject on destroy. |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | MediaMTX HLS local `http://127.0.0.1:8888/live/test/index.m3u8` | repeated HLS reload after user-reported duplicated audio | pass | After HLS cleanup hardening and demo command serialization, three repeated loads stayed at `videoCount=1`, `audioCount=0`, `fyra-ui-shell=1`, `state='playing'`, `muted=false`, `readyState=4`, `1280x720`; no front-end duplicate media element or UI shell accumulation was observed. |
| 2026-05-17 | Codex | Chrome 148.0.0.0 / Windows 10 | MediaMTX WebRTC WHEP local `http://127.0.0.1:8889/live/test/whep` | WebRTC audio no-sound investigation | partial | Player-side forced mute and extra `AudioContext` output path were removed. Browser state showed `video.muted=false`, one `video`, zero `audio`, and one WebRTC audio track, but the track was `muted=true` and `webkitAudioDecodedByteCount=0`; this points to source/server codec delivery rather than player volume. Added `WEBRTC_AUDIO_MUTED` diagnostic for this state. |
| 2026-05-18 | Codex | Jest + TypeScript / Windows | MediaMTX HLS config + Player reconnect lifecycle | user-reported HLS audio loop and reconnect instability regression | pass | Added `tests/hls-config.test.ts` and Player regressions. Normal HLS now explicitly uses `lowLatencyMode: false`, `liveSyncMode: 'buffered'`, `liveSyncDurationCount: 3`, `liveMaxLatencyDurationCount: 6`, bounded buffer, and audio drift tolerance. Fatal network reconnect no longer marks the active Tech as failed, resets failed Techs before retry, clears a pending reconnect timer on `ready`, skips stale reload when same-source playback is healthy and time advances, and cancels old pending reconnect when switching source. `cmd /c pnpm exec jest tests/hls-config.test.ts tests/player.test.ts --runInBand` passed; TypeScript validation passed. Real MediaMTX long-run/interruption retest remains pending. |
| 2026-05-18 | Codex | Chrome 148.0.0.0 / Windows 10 | MediaMTX HLS local `http://127.0.0.1:8888/live/test/index.m3u8` | runtime HLS config smoke after audio-loop fix | partial | Vite demo on `http://127.0.0.1:4185/basic.html`; active source `lowLatency=false`, current Tech `hls`, hls.js runtime config was `lowLatencyMode=false`, `liveSyncMode='buffered'`, `liveSyncDurationCount=3`, `liveMaxLatencyDurationCount=6`, `maxBufferLength=12`, `backBufferLength=30`, `maxAudioFramesDrift=5`; playback stayed `playing` after a short run, `readyState=4`, `1280x720`, one `video`, zero extra `audio`, one UI shell, `webkitAudioDecodedByteCount` increased, and dropped frames stayed 0. hls.js still surfaced non-fatal `levelLoadTimeOut` / `audioTrackLoadTimeOut` warnings against MediaMTX LL-HLS-style sub-playlists; listening/long-run confirmation remains with the user. |

---

## 7. Promotion Rules

- A protocol is `verified` only after at least Chrome and Edge pass, unless the browser scope explicitly excludes it.
- Safari support must be recorded separately because native HLS and WebCodecs/MSE behavior differ.
- Public docs should call a source/protocol `experimental` until at least one real browser run exists in this file.
- GB28181 means server-side gateway integration. The browser player does not implement SIP/RTP/PS; placeholders are acceptable, but they do not count as commercial verification.
