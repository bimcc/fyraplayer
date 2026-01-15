import { BufferPolicy, ReconnectPolicy, TechName, MetricsOptions } from '../types.js';

export const DEFAULT_TECH_ORDER: TechName[] = ['gb28181', 'webrtc', 'ws-raw', 'hls', 'dash', 'fmp4', 'file'];

export const DEFAULT_BUFFER_POLICY: BufferPolicy = {
  targetLatencyMs: 2000,
  jitterBufferMs: 120,
  maxBufferMs: 12000,
  catchUpMode: 'drop-bp',
  decodeBudgetMs: 10
};

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  enabled: true,
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
  heartbeatMs: 5000,
  timeoutMs: 12000,
  jitter: 0.2
};

export const DEFAULT_DATA_CHANNEL = {
  enable: false,
  label: 'data',
  heartbeatMs: 5000
};

export const DEFAULT_METRICS_OPTIONS: MetricsOptions = {
  statsIntervalMs: 1000,
  qosIntervalMs: 5000
};
