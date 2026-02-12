import { deriveCodecFromAnnexB, parseH264CodecFromSps, parseH265CodecFromNalus } from './codecStrings.js';
import { H264_PROBE_CODECS, H265_PROBE_CODECS, pickFirstSupported } from './webcodecs.js';

export type VideoCodecHint = 'h264' | 'h265';

export interface WebCodecsDecisionInput {
  annexb?: Uint8Array;
  sps?: Uint8Array;
  vps?: Uint8Array;
  codecHint?: VideoCodecHint;
  allowH265?: boolean;
  preferredCodecs?: string[];
}

export interface WebCodecsDecision {
  codec: string | null;
  candidates: string[];
  derived: string | null;
  supported: boolean;
  reason?: string;
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function isH265Codec(codec: string | null): boolean {
  if (!codec) return false;
  return codec.startsWith('hvc1') || codec.startsWith('hev1');
}

export async function decideWebCodecsCodec(input: WebCodecsDecisionInput): Promise<WebCodecsDecision> {
  const allowH265 = input.allowH265 !== false;
  let derived: string | null = null;

  if (input.sps && (!input.vps || input.codecHint === 'h264')) {
    derived = parseH264CodecFromSps(input.sps);
  } else if (input.vps || input.codecHint === 'h265') {
    const nalus: Uint8Array[] = [];
    if (input.vps) nalus.push(input.vps);
    if (input.sps) nalus.push(input.sps);
    derived = parseH265CodecFromNalus(nalus);
  }

  if (!derived && input.annexb) {
    derived = deriveCodecFromAnnexB(input.annexb);
  }

  if (isH265Codec(derived) && !allowH265) {
    return { codec: null, candidates: [], derived, supported: false, reason: 'h265-disabled' };
  }

  const hint = input.codecHint || (isH265Codec(derived) ? 'h265' : 'h264');
  const fallback = hint === 'h265' ? H265_PROBE_CODECS : H264_PROBE_CODECS;
  const candidates = unique([...(derived ? [derived] : []), ...(input.preferredCodecs ?? []), ...fallback]);

  if (!candidates.length) {
    return { codec: null, candidates: [], derived, supported: false, reason: 'no-candidates' };
  }

  const selected = await pickFirstSupported(candidates);
  return {
    codec: selected,
    candidates,
    derived,
    supported: !!selected,
    reason: selected ? undefined : 'unsupported'
  };
}
