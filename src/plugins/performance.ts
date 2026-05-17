import type {
  EngineStats,
  PlayerQosEvent,
  PlayerStatsEvent,
  PlayerState,
  PluginCtor,
  TechName,
} from '../types.js';

export type PerformanceFpsMode = 'auto' | 'reported' | 'cumulative';

export type PerformanceViolationCode =
  | 'LOW_FPS'
  | 'HIGH_DROPPED_FRAMES'
  | 'HIGH_DROPPED_FRAME_RATIO'
  | 'HIGH_DECODE_LATENCY'
  | 'HIGH_LIVE_LATENCY'
  | 'HIGH_RTT'
  | 'HIGH_JITTER'
  | 'HIGH_PACKET_LOSS'
  | 'HIGH_PENDING_SEGMENTS'
  | 'HIGH_PENDING_BYTES'
  | 'LOW_BUFFER'
  | 'HIGH_BUFFER';

export interface PerformanceBudget {
  minFps?: number;
  maxDroppedFramesPerMinute?: number;
  maxDroppedFrameRatio?: number;
  maxDecodeLatencyMs?: number;
  maxLiveLatencyMs?: number;
  maxRttMs?: number;
  maxJitterMs?: number;
  maxPacketLoss?: number;
  maxPendingSegments?: number;
  maxPendingBytes?: number;
  minBufferLevel?: number;
  maxBufferLevel?: number;
}

export interface PerformanceSample {
  tech?: TechName | null;
  ts: number;
  sequence: number;
  stats: EngineStats;
  reportedFps?: number;
  sampledFps?: number;
  fps?: number;
  fpsSource?: 'reported' | 'frame-delta';
  sampleWindowMs?: number;
  frameDelta?: number;
  droppedFrames?: number;
  droppedFramesDelta?: number;
  droppedFramesPerMinute?: number;
  droppedFrameRatio?: number;
}

export interface PerformanceViolation {
  code: PerformanceViolationCode;
  severity: 'warning';
  metric: string;
  value: number;
  threshold: number;
  sample: PerformanceSample;
  message: string;
}

export interface PerformanceMonitorOptions {
  /** Global performance budget. Undefined fields inherit DEFAULT_PERFORMANCE_BUDGET. */
  budget?: PerformanceBudget;
  /** Optional per-Tech overrides, keyed by public Tech name. */
  budgetsByTech?: Record<string, PerformanceBudget | undefined>;
  /** How to interpret EngineStats.fps. Auto handles current built-in Techs. */
  fpsMode?: PerformanceFpsMode;
  /** Per-Tech fps interpretation override. */
  fpsModeByTech?: Record<string, PerformanceFpsMode | undefined>;
  /** Budget evaluation mode. Defaults to `playing` to avoid paused/idle low-FPS noise. */
  evaluationMode?: 'playing' | 'always';
  /** Called for every normalized stats sample. */
  onSample?: (sample: PerformanceSample) => void;
  /** Called when a sample breaches the resolved budget. */
  onViolation?: (violation: PerformanceViolation) => void;
  /** Called after onSample/onViolation for generic reporter plumbing. */
  onEvent?: (event: 'sample' | 'violation', payload: PerformanceSample | PerformanceViolation) => void;
  /** Emit public qos events for budget violations. Defaults to true. */
  emitQos?: boolean;
  /** Suppress repeated violations for the same Tech/code/metric. Defaults to 30000. */
  violationCooldownMs?: number;
}

export const DEFAULT_PERFORMANCE_BUDGET: PerformanceBudget = {
  minFps: 20,
  maxDroppedFramesPerMinute: 120,
  maxDroppedFrameRatio: 0.1,
  maxDecodeLatencyMs: 80,
  maxLiveLatencyMs: 5_000,
  maxRttMs: 1_000,
  maxJitterMs: 100,
  maxPendingSegments: 120,
  maxPendingBytes: 64 * 1024 * 1024,
  maxBufferLevel: 30,
};

interface PreviousSampleState {
  ts: number;
  sequence: number;
  reportedFps?: number;
  droppedFrames?: number;
}

function asStatsPayload(payload: unknown): PlayerStatsEvent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Partial<PlayerStatsEvent>;
  if (typeof record.stats !== 'object' || record.stats === null) return null;
  return record as PlayerStatsEvent;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getStatsNumber(stats: EngineStats, key: string): number | undefined {
  return finiteNumber((stats as unknown as Record<string, unknown>)[key]);
}

function getDroppedFrames(stats: EngineStats): number | undefined {
  return (
    finiteNumber(stats.droppedFrames) ??
    getStatsNumber(stats, 'framesDropped') ??
    getStatsNumber(stats, 'dropped')
  );
}

function resolveFpsMode(
  tech: TechName | null | undefined,
  _stats: EngineStats,
  options: PerformanceMonitorOptions
): PerformanceFpsMode {
  const key = tech ?? 'unknown';
  const override = options.fpsModeByTech?.[key] ?? options.fpsMode;
  if (override && override !== 'auto') return override;
  return 'reported';
}

function normalizeSample(
  payload: PlayerStatsEvent,
  previous: PreviousSampleState | undefined,
  options: PerformanceMonitorOptions
): PerformanceSample {
  const stats = payload.stats ?? { ts: Date.now() };
  const ts = finiteNumber(stats.ts) ?? Date.now();
  const reportedFps = finiteNumber(stats.fps);
  const droppedFrames = getDroppedFrames(stats);
  const sampleWindowMs = previous ? Math.max(1, ts - previous.ts) : undefined;
  const sequence = (previous?.sequence ?? 0) + 1;
  const fpsMode = resolveFpsMode(payload.tech, stats, options);

  let sampledFps: number | undefined;
  let frameDelta: number | undefined;
  let fps = fpsMode === 'reported' ? reportedFps : undefined;
  let fpsSource: PerformanceSample['fpsSource'] = fps === undefined ? undefined : 'reported';

  if (
    fpsMode === 'cumulative' &&
    previous &&
    sampleWindowMs &&
    reportedFps !== undefined &&
    previous.reportedFps !== undefined &&
    reportedFps >= previous.reportedFps
  ) {
    frameDelta = reportedFps - previous.reportedFps;
    sampledFps = frameDelta / (sampleWindowMs / 1000);
    fps = sampledFps;
    fpsSource = 'frame-delta';
  } else if (fpsMode === 'reported' && previous && sampleWindowMs && reportedFps !== undefined) {
    frameDelta = reportedFps * (sampleWindowMs / 1000);
  }

  let droppedFramesDelta: number | undefined;
  let droppedFramesPerMinute: number | undefined;
  let droppedFrameRatio: number | undefined;
  if (
    previous &&
    sampleWindowMs &&
    droppedFrames !== undefined &&
    previous.droppedFrames !== undefined &&
    droppedFrames >= previous.droppedFrames
  ) {
    droppedFramesDelta = droppedFrames - previous.droppedFrames;
    droppedFramesPerMinute = droppedFramesDelta / (sampleWindowMs / 60_000);
    if (frameDelta !== undefined && frameDelta + droppedFramesDelta > 0) {
      droppedFrameRatio = droppedFramesDelta / (frameDelta + droppedFramesDelta);
    }
  }

  return {
    tech: payload.tech,
    ts,
    sequence,
    stats,
    reportedFps,
    sampledFps,
    fps,
    fpsSource,
    sampleWindowMs,
    frameDelta,
    droppedFrames,
    droppedFramesDelta,
    droppedFramesPerMinute,
    droppedFrameRatio,
  };
}

function threshold(value: number | undefined): number | undefined {
  return value === undefined || Number.isNaN(value) ? undefined : value;
}

function buildViolation(
  sample: PerformanceSample,
  code: PerformanceViolationCode,
  metric: string,
  value: number,
  thresholdValue: number,
  comparison: 'below' | 'above'
): PerformanceViolation {
  const direction = comparison === 'below' ? 'below' : 'above';
  return {
    code,
    severity: 'warning',
    metric,
    value,
    threshold: thresholdValue,
    sample,
    message: `Performance budget ${code}: ${metric}=${formatMetric(value)} ${direction} ${formatMetric(thresholdValue)}`,
  };
}

function formatMetric(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function evaluateBudget(sample: PerformanceSample, budget: PerformanceBudget): PerformanceViolation[] {
  const stats = sample.stats;
  const violations: PerformanceViolation[] = [];

  const minFps = threshold(budget.minFps);
  if (minFps !== undefined && sample.fps !== undefined && sample.fps < minFps) {
    violations.push(buildViolation(sample, 'LOW_FPS', 'fps', sample.fps, minFps, 'below'));
  }

  const maxDroppedFramesPerMinute = threshold(budget.maxDroppedFramesPerMinute);
  if (
    maxDroppedFramesPerMinute !== undefined &&
    sample.droppedFramesPerMinute !== undefined &&
    sample.droppedFramesPerMinute > maxDroppedFramesPerMinute
  ) {
    violations.push(
      buildViolation(
        sample,
        'HIGH_DROPPED_FRAMES',
        'droppedFramesPerMinute',
        sample.droppedFramesPerMinute,
        maxDroppedFramesPerMinute,
        'above'
      )
    );
  }

  const maxDroppedFrameRatio = threshold(budget.maxDroppedFrameRatio);
  if (
    maxDroppedFrameRatio !== undefined &&
    sample.droppedFrameRatio !== undefined &&
    sample.droppedFrameRatio > maxDroppedFrameRatio
  ) {
    violations.push(
      buildViolation(
        sample,
        'HIGH_DROPPED_FRAME_RATIO',
        'droppedFrameRatio',
        sample.droppedFrameRatio,
        maxDroppedFrameRatio,
        'above'
      )
    );
  }

  addAboveViolation(violations, sample, 'HIGH_DECODE_LATENCY', 'decodeLatencyMs', stats.decodeLatencyMs, budget.maxDecodeLatencyMs);
  addAboveViolation(violations, sample, 'HIGH_LIVE_LATENCY', 'liveLatencyMs', stats.liveLatencyMs, budget.maxLiveLatencyMs);
  addAboveViolation(violations, sample, 'HIGH_RTT', 'rttMs', stats.rttMs, budget.maxRttMs);
  addAboveViolation(violations, sample, 'HIGH_JITTER', 'jitterMs', stats.jitterMs, budget.maxJitterMs);
  addAboveViolation(violations, sample, 'HIGH_PACKET_LOSS', 'packetLoss', stats.packetLoss, budget.maxPacketLoss);
  addAboveViolation(violations, sample, 'HIGH_PENDING_SEGMENTS', 'pendingSegments', stats.pendingSegments, budget.maxPendingSegments);
  addAboveViolation(violations, sample, 'HIGH_PENDING_BYTES', 'pendingBytes', stats.pendingBytes, budget.maxPendingBytes);
  addAboveViolation(violations, sample, 'HIGH_BUFFER', 'bufferLevel', stats.bufferLevel, budget.maxBufferLevel);

  const minBufferLevel = threshold(budget.minBufferLevel);
  if (minBufferLevel !== undefined && stats.bufferLevel !== undefined && stats.bufferLevel < minBufferLevel) {
    violations.push(buildViolation(sample, 'LOW_BUFFER', 'bufferLevel', stats.bufferLevel, minBufferLevel, 'below'));
  }

  return violations;
}

function addAboveViolation(
  violations: PerformanceViolation[],
  sample: PerformanceSample,
  code: PerformanceViolationCode,
  metric: keyof EngineStats,
  value: number | undefined,
  thresholdValue: number | undefined
): void {
  const resolvedThreshold = threshold(thresholdValue);
  if (resolvedThreshold === undefined || value === undefined || value <= resolvedThreshold) return;
  violations.push(buildViolation(sample, code, metric, value, resolvedThreshold, 'above'));
}

function mergeBudget(options: PerformanceMonitorOptions, tech?: TechName | null): PerformanceBudget {
  return {
    ...DEFAULT_PERFORMANCE_BUDGET,
    ...options.budget,
    ...(tech ? options.budgetsByTech?.[tech] : undefined),
  };
}

function qosFromViolation(violation: PerformanceViolation): PlayerQosEvent {
  return {
    type: 'performance-budget',
    code: 'PERFORMANCE_BUDGET',
    severity: violation.severity,
    message: violation.message,
    tech: violation.sample.tech ?? undefined,
    ts: violation.sample.ts,
    reason: violation.code,
    metric: violation.metric,
    value: violation.value,
    threshold: violation.threshold,
  };
}

export function createPerformanceMonitorPlugin(options: PerformanceMonitorOptions = {}): PluginCtor {
  return ({ coreBus, player }) => {
    const previousByTech = new Map<string, PreviousSampleState>();
    const lastViolationAt = new Map<string, number>();
    const emitQos = options.emitQos !== false;
    const cooldownMs = options.violationCooldownMs ?? 30_000;
    const evaluationMode = options.evaluationMode ?? 'playing';

    const getPlayerState = (): PlayerState | undefined => {
      try {
        return player.getState();
      } catch {
        return undefined;
      }
    };

    const shouldEvaluateSample = (): boolean => {
      if (evaluationMode === 'always') return true;
      return getPlayerState() === 'playing';
    };

    const shouldReportViolation = (violation: PerformanceViolation): boolean => {
      if (cooldownMs <= 0) return true;
      const key = `${violation.sample.tech ?? 'unknown'}:${violation.code}:${violation.metric}`;
      const lastTs = lastViolationAt.get(key);
      if (lastTs !== undefined && violation.sample.ts - lastTs < cooldownMs) {
        return false;
      }
      lastViolationAt.set(key, violation.sample.ts);
      return true;
    };

    const statsHandler = (payload: unknown) => {
      const statsPayload = asStatsPayload(payload);
      if (!statsPayload) return;
      const key = statsPayload.tech ?? 'unknown';
      const previous = previousByTech.get(key);
      const sample = normalizeSample(statsPayload, previous, options);
      previousByTech.set(key, {
        ts: sample.ts,
        sequence: sample.sequence,
        reportedFps: sample.reportedFps,
        droppedFrames: sample.droppedFrames,
      });

      options.onSample?.(sample);
      options.onEvent?.('sample', sample);

      if (!shouldEvaluateSample()) return;

      const budget = mergeBudget(options, statsPayload.tech);
      for (const violation of evaluateBudget(sample, budget)) {
        if (!shouldReportViolation(violation)) continue;
        options.onViolation?.(violation);
        options.onEvent?.('violation', violation);
        if (emitQos) {
          coreBus.emit('qos', qosFromViolation(violation));
        }
      }
    };

    coreBus.on('stats', statsHandler);

    return {
      destroy: () => {
        coreBus.off('stats', statsHandler);
        previousByTech.clear();
        lastViolationAt.clear();
      },
    };
  };
}
