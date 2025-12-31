export interface WebCodecsSupport {
  h264: boolean;
  h265: boolean;
  av1: boolean;
  vp9: boolean;
}

function hasVideoDecoder(): boolean {
  return typeof window !== 'undefined' && typeof (window as any).VideoDecoder !== 'undefined';
}

async function checkCodec(codec: string): Promise<boolean> {
  if (!hasVideoDecoder()) return false;
  try {
    const supported = await (window as any).VideoDecoder.isConfigSupported({ codec });
    return !!supported?.supported;
  } catch {
    return false;
  }
}

/**
 * Probe common codecs for WebCodecs availability. Lightweight and safe to call in UI.
 */
export async function probeWebCodecs(): Promise<WebCodecsSupport> {
  const [h264, h265, av1, vp9] = await Promise.all([
    checkCodec('avc1.42E01E'),
    checkCodec('hvc1.1.6.L93.B0'),
    checkCodec('av01.0.04M.08'),
    checkCodec('vp09.00.10.08')
  ]);
  return { h264, h265, av1, vp9 };
}
