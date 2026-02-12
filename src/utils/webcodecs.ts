export interface WebCodecsSupport {
  h264: boolean;
  h265: boolean;
  av1: boolean;
  vp9: boolean;
  /** Supported H.264 codec strings (ordered by probe priority) */
  h264Codecs?: string[];
  /** Supported H.265 codec strings (ordered by probe priority) */
  h265Codecs?: string[];
}

interface VideoDecoderSupportResult {
  supported?: boolean;
}

function hasVideoDecoder(): boolean {
  return typeof VideoDecoder !== 'undefined' && typeof VideoDecoder.isConfigSupported === 'function';
}

export const H264_PROBE_CODECS = [
  'avc1.42E01E', // Baseline@3.0
  'avc1.4D401E', // Main@3.0
  'avc1.4D4028', // Main@4.0
  'avc1.64001F', // High@3.1
  'avc1.640028', // High@4.0
  'avc1.6E0032', // High10@5.0
  'avc1.7A0032', // High422@5.0
  'avc1.F40032'  // High444@5.0
];

export const H265_PROBE_CODECS = [
  'hvc1.1.6.L93.B0',  // Main
  'hvc1.2.4.L123.B0', // Main10
  'hev1.1.6.L93.B0'   // AnnexB-style parameter sets
];

async function checkCodec(codec: string): Promise<boolean> {
  if (!hasVideoDecoder()) return false;
  try {
    const supported = (await VideoDecoder.isConfigSupported({ codec })) as VideoDecoderSupportResult;
    return !!supported?.supported;
  } catch {
    return false;
  }
}

export async function pickFirstSupported(codecs: string[]): Promise<string | null> {
  const results = await Promise.all(codecs.map(async (c) => ({ codec: c, ok: await checkCodec(c) })));
  const supported = results.filter((r) => r.ok);
  return supported.length ? supported[0].codec : null;
}

async function probeList(codecs: string[]): Promise<{ hasAny: boolean; supported: string[] }> {
  const results = await Promise.all(codecs.map(async (c) => ({ codec: c, ok: await checkCodec(c) })));
  const supported = results.filter((r) => r.ok).map((r) => r.codec);
  return { hasAny: supported.length > 0, supported };
}

/**
 * Probe common codecs for WebCodecs availability. Lightweight and safe to call in UI.
 */
export async function probeWebCodecs(): Promise<WebCodecsSupport> {
  const [h264Probe, h265Probe, av1, vp9] = await Promise.all([
    probeList(H264_PROBE_CODECS),
    probeList(H265_PROBE_CODECS),
    checkCodec('av01.0.04M.08'),
    checkCodec('vp09.00.10.08')
  ]);
  return {
    h264: h264Probe.hasAny,
    h265: h265Probe.hasAny,
    av1,
    vp9,
    h264Codecs: h264Probe.supported,
    h265Codecs: h265Probe.supported
  };
}
