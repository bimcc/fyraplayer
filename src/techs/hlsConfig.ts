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
    maxBufferLength = Math.min(4, buffer.maxBufferMs / 1000);
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
