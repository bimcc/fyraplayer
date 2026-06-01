import {
  buildBrowserManagedMp4MimeCandidates,
  isH265CodecString,
  probeBrowserManagedCodecs,
  selectSupportedMediaSourceMime
} from '../src/utils/browserCodecs.js';

class FakeMediaSource {
  static supported = new Set<string>();

  static isTypeSupported(mimeType: string): boolean {
    return FakeMediaSource.supported.has(mimeType);
  }
}

describe('utils/browserCodecs', () => {
  const originalMediaSource = (globalThis as unknown as { MediaSource?: typeof MediaSource }).MediaSource;
  const originalDocument = (globalThis as unknown as { document?: Document }).document;

  afterEach(() => {
    (globalThis as unknown as { MediaSource?: typeof MediaSource }).MediaSource = originalMediaSource;
    (globalThis as unknown as { document?: Document }).document = originalDocument;
    FakeMediaSource.supported.clear();
  });

  test('builds hvc1 and hev1 candidates for browser-managed H.265 playback', () => {
    const candidates = buildBrowserManagedMp4MimeCandidates({ codec: 'h265' });

    expect(candidates).toContain('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"');
    expect(candidates).toContain('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"');
  });

  test('preserves the existing fMP4 H.264 default before broad fallback candidates', () => {
    const candidates = buildBrowserManagedMp4MimeCandidates({ codec: 'h264' });

    expect(candidates[0]).toBe('video/mp4; codecs="avc1.64001f,mp4a.40.2"');
  });

  test('selects the first MediaSource-supported MIME candidate', () => {
    const supported = 'video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"';
    FakeMediaSource.supported.add(supported);
    (globalThis as unknown as { MediaSource: typeof MediaSource }).MediaSource = FakeMediaSource as unknown as typeof MediaSource;

    const result = selectSupportedMediaSourceMime([
      'video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"',
      supported
    ]);

    expect(result.mimeType).toBe(supported);
    expect(result.unsupported).toEqual(['video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"']);
  });

  test('probes native and MediaSource browser-managed support without WebCodecs', () => {
    const mseMime = 'video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"';
    FakeMediaSource.supported.add(mseMime);
    (globalThis as unknown as { MediaSource: typeof MediaSource }).MediaSource = FakeMediaSource as unknown as typeof MediaSource;
    const video = {
      canPlayType: (mimeType: string) => mimeType === 'application/vnd.apple.mpegurl' ? 'probably' : ''
    } as HTMLVideoElement;
    (globalThis as unknown as { document: Document }).document = {
      createElement: jest.fn(() => ({
        ...video
      }))
    } as unknown as Document;

    const support = probeBrowserManagedCodecs();

    expect(support.mediaSource.h265).toBe(true);
    expect(support.mediaSource.h265MimeTypes).toEqual([mseMime]);
    expect(support.nativeVideo.hls).toBe(true);
    expect(support.nativeVideo.mp4H265).toBe(false);
  });

  test('classifies hvc1 and hev1 as H.265 codec strings', () => {
    expect(isH265CodecString('hvc1.1.6.L93.B0')).toBe(true);
    expect(isH265CodecString('hev1.1.6.L93.B0')).toBe(true);
    expect(isH265CodecString('avc1.64001f')).toBe(false);
  });
});
