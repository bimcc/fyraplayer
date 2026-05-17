import { deriveCodecFromAnnexB, parseH264CodecFromSps } from '../src/utils/codecStrings.js';

describe('utils/codecStrings', () => {
  test('parseH264CodecFromSps extracts avc1 profile-level tuple', () => {
    const spsNal = new Uint8Array([
      0x67, // NAL type 7
      0x42, // profile_idc
      0xE0, // compatibility
      0x1E  // level_idc
    ]);
    expect(parseH264CodecFromSps(spsNal)).toBe('avc1.42E01E');
  });

  test('deriveCodecFromAnnexB derives h264 codec from annex-b frame', () => {
    const annexb = new Uint8Array([
      0x00, 0x00, 0x00, 0x01,
      0x67, 0x42, 0xE0, 0x1E,
      0x00, 0x00, 0x00, 0x01,
      0x65, 0x88
    ]);

    expect(deriveCodecFromAnnexB(annexb, 'h264')).toBe('avc1.42E01E');
  });

  test('returns null for malformed short input', () => {
    expect(parseH264CodecFromSps(new Uint8Array([0x67]))).toBeNull();
    expect(deriveCodecFromAnnexB(new Uint8Array([1, 2, 3]), 'h264')).toBeNull();
  });
});

