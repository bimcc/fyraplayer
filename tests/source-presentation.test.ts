import { getSourcePresentation, isPanoramaSource } from '../src/types.js';
import type { Source } from '../src/types.js';

describe('source presentation metadata', () => {
  test('reads explicit source presentation config', () => {
    const source: Source = {
      type: 'hls',
      url: 'https://example.com/live360.m3u8',
      presentation: {
        mode: 'panorama',
        projection: 'equirectangular',
        renderer: 'panoramalite',
        textureFlipX: false,
        textureFlipY: true,
      },
    };

    expect(isPanoramaSource(source)).toBe(true);
    expect(getSourcePresentation(source)).toEqual({
      mode: 'panorama',
      projection: 'equirectangular',
      renderer: 'panoramalite',
      textureFlipX: false,
      textureFlipY: true,
    });
  });

  test('infers panorama mode from platform tags and legacy demo flag', () => {
    const taggedSource: Source = {
      type: 'dash',
      url: 'https://example.com/live360.mpd',
      meta: {
        tags: ['inspection', '360'],
      },
    };
    const legacySource = {
      type: 'file',
      url: 'https://example.com/pano.mp4',
      panorama: true,
    } as Source & { panorama: boolean };

    expect(getSourcePresentation(taggedSource)).toEqual({
      mode: 'panorama',
      projection: 'equirectangular',
    });
    expect(isPanoramaSource(legacySource)).toBe(true);
  });
});
