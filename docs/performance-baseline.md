# FyraPlayer Performance Baseline

> Created: 2026-05-17  
> Purpose: define the current performance sampling contract, default budgets, and remaining profiling evidence needed before commercial performance claims.

This is a baseline contract, not a final optimization report. The code can now collect normalized performance samples and flag budget breaches, but real long-run browser profiling still belongs in `docs/playback-verification-matrix.md`.

---

## 1. Scope

Current scope:

- Normalize `stats` events into `PerformanceSample` objects.
- Evaluate default or product-provided performance budgets.
- Emit optional `qos` warnings with `code: 'PERFORMANCE_BUDGET'`.
- Keep monitoring optional through `createPerformanceMonitorPlugin()`.
- Correct built-in HTML video FPS sampling so cumulative frame counts are not exposed as FPS.
- Evaluate budgets only while the Player state is `playing` by default, to avoid paused/idle false positives.

Out of scope for this pass:

- Claiming all protocols are optimized.
- Full long-run MediaMTX/WebRTC performance proof.
- Real fMP4 live-stream memory proof.
- Browser-specific tuning for Safari/Firefox/Edge.
- WebGL/canvas renderer optimization outside FyraPlayer core.

---

## 2. Plugin Usage

```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import { createPerformanceMonitorPlugin } from '@bimccfyra/fyraplayer/plugins/performance';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/stream.m3u8' }],
  metrics: { statsIntervalMs: 1000 },
  plugins: [
    createPerformanceMonitorPlugin({
      budget: {
        minFps: 24,
        maxDecodeLatencyMs: 80,
        maxLiveLatencyMs: 5000,
        maxPendingBytes: 64 * 1024 * 1024
      },
      budgetsByTech: {
        webrtc: { maxRttMs: 800, maxJitterMs: 80 },
        fmp4: { maxPendingSegments: 120 }
      },
      onSample: (sample) => {
        console.debug('performance sample', sample.tech, sample.fps);
      },
      onViolation: (violation) => {
        console.warn('performance budget breach', violation.code, violation.message);
      }
    })
  ]
});
```

The plugin listens to public `stats` events only. It does not control playback, switch quality, reconnect, or mutate Tech internals.

---

## 3. Default Budgets

`DEFAULT_PERFORMANCE_BUDGET` currently uses conservative warning thresholds:

| Metric | Default |
|---|---:|
| `minFps` | `20` |
| `maxDroppedFramesPerMinute` | `120` |
| `maxDroppedFrameRatio` | `0.1` |
| `maxDecodeLatencyMs` | `80` |
| `maxLiveLatencyMs` | `5000` |
| `maxRttMs` | `1000` |
| `maxJitterMs` | `100` |
| `maxPendingSegments` | `120` |
| `maxPendingBytes` | `64 MiB` |
| `maxBufferLevel` | `30s` |

These are warning thresholds for operations and QA. They are not proof that every stream should meet them on every device.

---

## 4. Sample Contract

`PerformanceSample` keeps the original `EngineStats` snapshot and adds derived fields:

- `reportedFps`: raw `EngineStats.fps`.
- `fps`: normalized FPS used for budget evaluation.
- `fpsSource`: `reported` or `frame-delta`.
- `sampleWindowMs`: elapsed time from the previous sample for the same Tech.
- `droppedFramesDelta`, `droppedFramesPerMinute`, `droppedFrameRatio`: derived when enough frame counters exist.
- `sequence`: monotonically increasing sample index per Tech key.

Built-in Tech note:

- `AbstractTech`, HLS, DASH, and fMP4 now compute `stats.fps` as a frame-rate sample from `getVideoPlaybackQuality().totalVideoFrames`.
- WebRTC already computes FPS from WebRTC stats deltas.
- The ws-raw experimental pipeline reports its own decoded-frame FPS.

For external or legacy Techs that still report cumulative frame counters in `stats.fps`, configure:

```ts
createPerformanceMonitorPlugin({
  fpsModeByTech: {
    'custom-tech': 'cumulative'
  }
});
```

---

## 5. Violation Contract

When a budget is breached, the plugin reports `PerformanceViolation`:

```ts
interface PerformanceViolation {
  code: PerformanceViolationCode;
  severity: 'warning';
  metric: string;
  value: number;
  threshold: number;
  sample: PerformanceSample;
  message: string;
}
```

Supported codes:

- `LOW_FPS`
- `HIGH_DROPPED_FRAMES`
- `HIGH_DROPPED_FRAME_RATIO`
- `HIGH_DECODE_LATENCY`
- `HIGH_LIVE_LATENCY`
- `HIGH_RTT`
- `HIGH_JITTER`
- `HIGH_PACKET_LOSS`
- `HIGH_PENDING_SEGMENTS`
- `HIGH_PENDING_BYTES`
- `LOW_BUFFER`
- `HIGH_BUFFER`

By default, repeated violations for the same Tech/code/metric are suppressed for 30 seconds. Set `violationCooldownMs: 0` for test or fully verbose reporting.

Budget evaluation defaults to `evaluationMode: 'playing'`. Samples are still
reported through `onSample` while paused or idle, but violations are not
evaluated unless playback is active. Use `evaluationMode: 'always'` only for
synthetic tests or custom diagnostics.

If `emitQos` is not disabled, every reported violation also emits:

```ts
{
  type: 'performance-budget',
  code: 'PERFORMANCE_BUDGET',
  severity: 'warning',
  tech,
  ts,
  reason,
  metric,
  value,
  threshold
}
```

---

## 6. Evidence Status

Implemented and verified:

- Plugin sampling and violation tests.
- Public package import for `@bimccfyra/fyraplayer/plugins/performance`.
- `PERFORMANCE_BUDGET` QoS code in the public type contract.
- Built-in HTML video FPS sampling regression test.
- Local Chrome MediaMTX WHEP smoke stats were recorded with bitrate, FPS, RTT, packet loss, candidate type, transport, dropped frames, and resolution.
- CDP browser long-run runner and JSON assertion gate.
- Edge 30-minute MediaMTX WHEP run with stable DOM/heap and a passing assertion.
- Edge 10-minute direct fMP4 fixture run with stable DOM/heap and no fatal events.
- Edge 30-minute MediaMTX HLS run that stayed playable and recovered after hls.js fatal events, recorded as recovery evidence rather than a clean zero-fatal pass.

Still pending after 1.0:

- HLS 30-minute zero-fatal retest or a documented recovered-fatal acceptance policy.
- WebRTC audio validation with an Opus-capable ingest path and speaker-output evidence.
- TURN relay and controlled interruption/reconnect performance evidence.
- Project-specific direct HTTP/WS fMP4 stream evidence beyond the local fixture.
- Safari/Firefox performance records.

Track those pending records under `CR-005` and `CR-013` in `docs/commercial-readiness-roadmap.md`.

---

## 7. 30-Minute Long-Run Procedure

Use tool-assisted sampling plus manual observation.

Manual-only watching is acceptable for subjective notes such as perceived
smoothness, audio/video sync, and whether the interruption prompt is readable,
but it is not enough for commercial acceptance. The acceptance record needs
sampled values so memory, media elements, dropped frames, and reconnect behavior
can be compared across runs.

Minimum sampling fields:

- timestamp and elapsed seconds;
- player `getState()`, current source type/URL, and current Tech when available;
- video `currentTime`, `readyState`, `videoWidth`, `videoHeight`, paused/ended state;
- buffered start/end for the active range when available;
- `getVideoPlaybackQuality()` total and dropped frames when available;
- DOM counts for `video`, `audio`, and `fyra-ui-shell`;
- Chrome `performance.memory.usedJSHeapSize` when available;
- latest `stats`, `network`, and `qos` events collected during the run.

Sampling interval:

- 5 seconds for interruption/reconnect runs;
- 10 seconds for steady HLS/DASH/live long-run checks.

Demo helper:

- start: `window.fyraLongRun.start(10000)`;
- stop: `window.fyraLongRun.stop()`;
- manual sample: `window.fyraLongRun.sample()`;
- export JSON: `window.fyraLongRun.getJson()`.

Scripted runner:

```bash
pnpm long-run:browser -- --source "HLS demo" --duration 30m --interval 10s --out .fyra-long-run/hls-edge-30m.json
pnpm long-run:assert -- .fyra-long-run/hls-edge-30m.json --require-tech hls --min-samples 150 --min-duration-sec 1740
```

The runner starts the examples Vite server, launches Edge by default, selects
the requested demo preset or a custom `--source-url` / `--source-type`, drives
`window.fyraLongRun`, and writes a JSON report with samples, events, final
video state, DOM counts, frame counters, and a summary. Use `--browser chrome`
or `--browser-path` for a specific browser binary. Use `--fail-on-error` in CI
or QA automation when a non-playable result should fail the command.

`pnpm long-run:assert` reads the JSON report produced by the runner or the
manual `window.fyraLongRun.getJson()` export and applies machine-checkable
acceptance gates. It checks sample count, sampled duration, final playable
state, current-time advance, fatal/error events, dropped-frame ratio, JS heap
growth when available, DOM media element growth, and optional live stall/end
rules. Keep the assertion output with the dated verification row when closing a
commercial long-run item.

Useful variants:

```bash
pnpm long-run:browser -- --source "Apple HLS fMP4/CMAF sample" --duration 10m --interval 10s --out .fyra-long-run/apple-hls-fmp4-edge-10m.json
pnpm long-run:assert -- .fyra-long-run/apple-hls-fmp4-edge-10m.json --require-tech hls --min-samples 50 --min-duration-sec 540
pnpm serve:fmp4-fixture
pnpm long-run:browser -- --url http://127.0.0.1:3000/basic.html --source-url http://127.0.0.1:18080/stream.fmp4 --source-type fmp4 --duration 10m --interval 10s --out .fyra-long-run/ffmpeg-fmp4-edge-10m.json --fail-on-error --expect-live
pnpm long-run:assert -- .fyra-long-run/ffmpeg-fmp4-edge-10m.json --require-tech fmp4 --expect-live --min-samples 50 --min-duration-sec 540
pnpm long-run:browser -- --source-url http://127.0.0.1:8888/live/test/index.m3u8 --source-type hls --duration 30m --interval 10s --out .fyra-long-run/mediamtx-hls-30m.json
pnpm long-run:assert -- .fyra-long-run/mediamtx-hls-30m.json --require-tech hls --expect-live --min-samples 150 --min-duration-sec 1740
pnpm long-run:browser -- --source "MediaMTX WebRTC WHEP local (live/test)" --duration 30m --interval 5s --expect-live --out .fyra-long-run/mediamtx-whep-30m.json
pnpm long-run:assert -- .fyra-long-run/mediamtx-whep-30m.json --require-tech webrtc --expect-live --min-samples 300 --min-duration-sec 1740
```

For a MediaMTX instance using custom ports such as RTMP `21935`, HLS `28888`,
and WebRTC/WHEP `28889`, use custom source URLs:

```bash
pnpm long-run:browser -- --source-url http://127.0.0.1:28888/live/test/index.m3u8 --source-type hls --duration 30m --interval 10s --out .fyra-long-run/mediamtx-hls-28888-edge-30m.json --fail-on-error --expect-live
pnpm long-run:assert -- .fyra-long-run/mediamtx-hls-28888-edge-30m.json --require-tech hls --expect-live --min-samples 150 --min-duration-sec 1740
pnpm long-run:browser -- --source-url http://127.0.0.1:28889/live/test/whep --source-type webrtc --duration 30m --interval 5s --out .fyra-long-run/mediamtx-whep-28889-edge-30m.json --fail-on-error --expect-live
pnpm long-run:assert -- .fyra-long-run/mediamtx-whep-28889-edge-30m.json --require-tech webrtc --expect-live --min-samples 300 --min-duration-sec 1740
```

Pass criteria for the first commercial baseline run:

- playback remains usable for 30 minutes or a reconnect recovers without page refresh;
- media element and UI shell counts stay stable;
- heap usage does not show unbounded growth after the initial warm-up;
- dropped-frame ratio does not trend upward continuously;
- no repeated fatal network loop remains unresolved;
- manual note confirms there is no persistent audio/video desync or visible overlay stuck after recovery.
- For direct fMP4 fixture testing, start `pnpm serve:fmp4-fixture` first. It serves `G:\MTX\fmp4test.mp4` as looping fragmented MP4 with CORS, which makes the browser evidence repeatable.
