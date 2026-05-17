import {
  autoDetectSourceType,
  detectFormatFromBytes,
  detectFormatFromContentType,
  detectFormatFromUrl,
  getRecommendedTechOrder
} from '../src/utils/formatDetector.js';

describe('utils/formatDetector', () => {
  test('detectFormatFromUrl handles ws flv and http hls', () => {
    const wsFlv = detectFormatFromUrl('wss://example.com/live/test.flv');
    expect(wsFlv.container).toBe('flv');
    expect(wsFlv.recommendedTech).toBe('ws-raw');

    const hls = detectFormatFromUrl('https://example.com/live/index.m3u8');
    expect(hls.container).toBe('hls');
    expect(hls.recommendedTech).toBe('hls');
  });

  test('detectFormatFromContentType maps known mime', () => {
    const format = detectFormatFromContentType('application/dash+xml; charset=utf-8');
    expect(format?.container).toBe('dash');
    expect(format?.recommendedTech).toBe('dash');
  });

  test('detectFormatFromBytes recognizes FLV and TS', () => {
    const flv = detectFormatFromBytes(new Uint8Array([0x46, 0x4c, 0x56, 0x01, 0, 0, 0, 0]));
    expect(flv?.container).toBe('flv');

    const ts = new Uint8Array(376);
    ts[0] = 0x47;
    ts[188] = 0x47;
    const tsFmt = detectFormatFromBytes(ts);
    expect(tsFmt?.container).toBe('ts');
  });

  test('autoDetectSourceType and recommended order are coherent for auto source', () => {
    expect(autoDetectSourceType('wss://example.com/live.flv')).toBe('ws-raw');
    const order = getRecommendedTechOrder({ type: 'auto', url: 'https://example.com/live.m3u8' });
    expect(order[0]).toBe('hls');
  });
});

