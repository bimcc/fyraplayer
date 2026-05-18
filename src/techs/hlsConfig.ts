/**
 * HLS Low-Latency Configuration Builder
 * Extracted for testability without browser dependencies
 */

import { BufferPolicy, HLSSource } from '../types.js';

/**
 * HLS.js config subset for low-latency mode
 */
export interface LowLatencyHlsConfig {
  lowLatencyMode?: boolean;
  liveSyncDurationCount?: number;
  liveMaxLatencyDurationCount?: number;
  maxBufferLength?: number;
  maxMaxBufferLength?: number;
  backBufferLength?: number;
}

export interface HlsPlaybackConfig extends LowLatencyHlsConfig {
  progressive?: boolean;
  liveSyncMode?: 'edge' | 'buffered';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Build the hls.js playback config used by HLSTech.
 *
 * hls.js defaults to lowLatencyMode=true. That is useful for LL-HLS, but it is
 * too aggressive for normal live playback. Non-LL sources are explicitly moved
 * to a buffered live mode so stability is prioritized before latency chasing.
 *
 * Do not override hls.js audio remux/gap defaults here; those controls should
 * only change with stream-level evidence and a matching regression test.
 */
export function buildHlsPlaybackConfig(source: HLSSource, buffer?: BufferPolicy): HlsPlaybackConfig {
  if (source.lowLatency) {
    return buildLowLatencyConfig(source, buffer);
  }

  const maxBufferLength = clamp((buffer?.maxBufferMs ?? 12000) / 1000, 6, 30);

  return {
    lowLatencyMode: false,
    progressive: false,
    liveSyncMode: 'buffered',
    liveSyncDurationCount: 3,
    liveMaxLatencyDurationCount: 6,
    maxBufferLength,
    maxMaxBufferLength: Math.max(30, maxBufferLength),
    backBufferLength: 30
  };
}

/**
 * Low-latency HLS configuration builder
 * Requirements 3.1, 3.2, 3.3, 3.4: Configure hls.js for optimal low-latency playback
 * 
 * @param source - HLS source configuration
 * @param buffer - Optional buffer policy for customization (Requirements 3.5)
 * @returns Partial HLS config for low-latency mode
 */
export function buildLowLatencyConfig(source: HLSSource, buffer?: BufferPolicy): LowLatencyHlsConfig {
  if (!source.lowLatency) return {};

  // Requirements 3.2: liveSyncDurationCount should be 1 or 2
  let liveSyncDurationCount = 2;
  if (buffer?.targetLatencyMs) {
    // Convert target latency to segment count (assuming ~2s segments)
    const targetSegments = Math.ceil(buffer.targetLatencyMs / 2000);
    liveSyncDurationCount = Math.max(1, Math.min(2, targetSegments));
  }

  // Requirements 3.3: liveMaxLatencyDurationCount should be ≤ 3
  const liveMaxLatencyDurationCount = 3;

  // Requirements 3.4: maxBufferLength should be ≤ 4 seconds
  let maxBufferLength = 4;
  if (buffer?.maxBufferMs) {
    maxBufferLength = clamp(buffer.maxBufferMs / 1000, 1, 4);
  }

  return {
    // Requirements 3.1: Enable low-latency mode
    lowLatencyMode: true,
    // Requirements 3.2: Set liveSyncDurationCount to 1 or 2
    liveSyncDurationCount,
    // Requirements 3.3: Set liveMaxLatencyDurationCount to 3 or less
    liveMaxLatencyDurationCount,
    // Requirements 3.4: Set maxBufferLength to 4 seconds or less
    maxBufferLength,
    // Additional low-latency optimizations
    maxMaxBufferLength: 8,
    backBufferLength: 0,
  };
}
