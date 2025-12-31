/**
 * AnnexB Demuxer
 * Handles raw H.264/H.265 AnnexB bitstream parsing
 */

import type { DemuxedFrame, DemuxerCallbacks } from './types.js';
import { splitAnnexBNalus, concatNalus } from './utils.js';
import { processSeiNalu, type SeiProcessorState } from './sei.js';

export interface AnnexBDemuxerContext {
  callbacks?: DemuxerCallbacks;
  seiState: SeiProcessorState;
}

export function demuxAnnexB(
  data: Uint8Array,
  ctx: AnnexBDemuxerContext
): DemuxedFrame[] {
  const nalus = splitAnnexBNalus(data);
  if (!nalus.length) return [];

  const frames: DemuxedFrame[] = [];
  let pts = 0;
  const step = 33; // ~30fps
  let current: Uint8Array[] = [];

  for (const nalu of nalus) {
    const nalType = nalu[0] & 0x1f;
    const isAud = nalType === 9;
    const isIdr = nalType === 5 || nalType === 7;
    const isSei = nalType === 6;

    // Check for SEI NAL units
    if (isSei && (ctx.callbacks?.onSEI || ctx.callbacks?.onSEIDetected)) {
      processSeiNalu(nalu, pts, ctx.callbacks, ctx.seiState);
    }

    if (isAud && current.length) {
      frames.push(nalusToFrame(current, pts));
      pts += step;
      current = [];
    }

    current.push(nalu);

    if (isIdr && current.length > 0) {
      frames.push(nalusToFrame(current, pts, true));
      pts += step;
      current = [];
    }
  }

  if (current.length) {
    frames.push(nalusToFrame(current, pts));
  }

  return frames;
}

function nalusToFrame(nalus: Uint8Array[], pts: number, forceKey = false): DemuxedFrame {
  return {
    pts,
    data: concatNalus(nalus),
    isKey: forceKey || nalus.some((n) => (n[0] & 0x1f) === 5),
    track: 'video'
  };
}
