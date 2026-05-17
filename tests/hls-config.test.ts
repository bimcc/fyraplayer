import { buildHlsPlaybackConfig } from '../src/techs/hlsConfig.js';

describe('HLS playback config', () => {
  test('forces normal live HLS into buffered mode instead of hls.js low-latency defaults', () => {
    const config = buildHlsPlaybackConfig(
      { type: 'hls', url: 'http://127.0.0.1:8888/live/test/index.m3u8', lowLatency: false },
      { maxBufferMs: 12000 }
    );

    expect(config).toMatchObject({
      lowLatencyMode: false,
      progressive: false,
      liveSyncMode: 'buffered',
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 6,
      maxBufferLength: 12,
      maxMaxBufferLength: 30,
      backBufferLength: 30,
      maxAudioFramesDrift: 5,
      nudgeOnVideoHole: false
    });
  });

  test('keeps LL-HLS explicit and bounded when source.lowLatency is true', () => {
    const config = buildHlsPlaybackConfig(
      { type: 'hls', url: 'https://example.com/live/llhls.m3u8', lowLatency: true },
      { targetLatencyMs: 1800, maxBufferMs: 3000 }
    );

    expect(config).toMatchObject({
      lowLatencyMode: true,
      liveSyncDurationCount: 1,
      liveMaxLatencyDurationCount: 3,
      maxBufferLength: 3,
      maxMaxBufferLength: 8,
      backBufferLength: 0
    });
    expect(config.liveSyncMode).toBeUndefined();
  });
});
