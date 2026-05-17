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
import { FyraPlayer } from 'fyraplayer';
import { createPerformanceMonitorPlugin } from 'fyraplayer/plugins/performance';

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
- Public package import for `fyraplayer/plugins/performance`.
- `PERFORMANCE_BUDGET` QoS code in the public type contract.
- Built-in HTML video FPS sampling regression test.
- Local Chrome MediaMTX WHEP smoke stats were recorded with bitrate, FPS, RTT, packet loss, candidate type, transport, dropped frames, and resolution.

Still pending:

- Long-run memory and listener growth evidence.
- Real fMP4 live stream bounded-buffer evidence.
- Long-run MediaMTX/WebRTC performance evidence, including WebRTC audio validation with an Opus-capable ingest path.
- Cross-browser performance records for Edge/Safari/Firefox.

Track those pending records under `CR-005` and `CR-013` in `docs/commercial-readiness-roadmap.md`.
