import { decideWebCodecsCodec } from '../src/utils/decodeDecision.js';

jest.mock('../src/utils/webcodecs.js', () => ({
  H264_PROBE_CODECS: ['avc1.42E01E', 'avc1.4D401E'],
  H265_PROBE_CODECS: ['hvc1.1.6.L93.B0', 'hev1.1.6.L93.B0'],
  pickFirstSupported: jest.fn(async (codecs: string[]) => codecs[0] ?? null)
}));

describe('utils/decodeDecision', () => {
  test('returns h265-disabled when derived codec is h265 and not allowed', async () => {
    const result = await decideWebCodecsCodec({
      codecHint: 'h265',
      annexb: new Uint8Array([
        0x00, 0x00, 0x00, 0x01,
        0x40, 0x01, 0x02, 0x03, 0x04,
        0x05, 0x06, 0x07, 0x08, 0x09,
        0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10
      ]),
      allowH265: false
    });

    expect(result.supported).toBe(false);
    expect(result.reason).toBe('h265-disabled');
    expect(result.candidates).toEqual([]);
  });

  test('selects first supported candidate from preferred+fallback list', async () => {
    const result = await decideWebCodecsCodec({
      codecHint: 'h264',
      preferredCodecs: ['avc1.640028']
    });

    expect(result.supported).toBe(true);
    expect(result.codec).toBe('avc1.640028');
    expect(result.candidates[0]).toBe('avc1.640028');
  });

  test('returns unsupported when picker yields null', async () => {
    const module = await import('../src/utils/webcodecs.js');
    const mockPick = module.pickFirstSupported as jest.Mock;
    mockPick.mockResolvedValueOnce(null);

    const result = await decideWebCodecsCodec({ codecHint: 'h264' });
    expect(result.supported).toBe(false);
    expect(result.reason).toBe('unsupported');
    expect(result.codec).toBeNull();
  });
});
