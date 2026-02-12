export interface GbCodecHints {
  videoCodec?: 'h264' | 'h265';
  audioCodec?: 'aac' | 'pcma' | 'pcmu' | 'opus';
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  sps?: Uint8Array;
  pps?: Uint8Array;
  vps?: Uint8Array;
  asc?: Uint8Array;
  opusHead?: Uint8Array;
  ptsBase?: number;
}

type GbInfoJson = {
  codecVideo?: 'h264' | 'h265';
  videoCodec?: 'h264' | 'h265';
  codecAudio?: 'aac' | 'pcma' | 'pcmu' | 'opus';
  audioCodec?: 'aac' | 'pcma' | 'pcmu' | 'opus';
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  ptsBase?: number;
  sps?: string | Uint8Array;
  pps?: string | Uint8Array;
  vps?: string | Uint8Array;
  asc?: string | Uint8Array;
  opusHead?: string | Uint8Array;
};

export interface ApplyGbStreamInfoResult {
  streamInfo?: GbCodecHints;
  ptsBase?: number;
  codec?: 'h264' | 'h265';
  resetWebCodecsConfig: boolean;
}

export function concatUint8Arrays(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function decodeMaybeBase64(input: string | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  try {
    const bin = atob(input);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new TextEncoder().encode(input);
  }
}

export function parseGbStreamInfoPayload(
  payload: Uint8Array,
  current?: GbCodecHints
): ApplyGbStreamInfoResult | null {
  if (!payload.length) return null;
  let jsonText: string;
  try {
    jsonText = new TextDecoder().decode(payload);
  } catch {
    return null;
  }

  let info: GbInfoJson;
  try {
    info = JSON.parse(jsonText) as GbInfoJson;
  } catch {
    return null;
  }

  const normalized: GbCodecHints = {
    videoCodec: info.codecVideo ?? info.videoCodec,
    audioCodec: info.codecAudio ?? info.audioCodec,
    width: info.width,
    height: info.height,
    sampleRate: info.sampleRate,
    channels: info.channels,
    ptsBase: info.ptsBase ?? 0,
    sps: info.sps ? decodeMaybeBase64(info.sps) : undefined,
    pps: info.pps ? decodeMaybeBase64(info.pps) : undefined,
    vps: info.vps ? decodeMaybeBase64(info.vps) : undefined,
    asc: info.asc ? decodeMaybeBase64(info.asc) : undefined,
    opusHead: info.opusHead ? decodeMaybeBase64(info.opusHead) : undefined
  };

  const normalizedDefined = Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined)
  ) as Partial<GbCodecHints>;
  const merged = { ...current, ...normalizedDefined };
  return {
    streamInfo: merged,
    ptsBase: typeof normalized.ptsBase === 'number' ? normalized.ptsBase : undefined,
    codec: normalized.videoCodec,
    resetWebCodecsConfig: !!(normalized.sps || normalized.vps || normalized.videoCodec)
  };
}
