import type { DemuxedFrame, DemuxerCallbacks } from './types.js';
import type { SeiProcessorState } from './sei.js';

export interface PsDemuxerState {
  lastPts: number;
}

export interface PsDemuxerContext {
  callbacks?: DemuxerCallbacks;
  seiState: SeiProcessorState;
}

export function createPsState(): PsDemuxerState {
  return { lastPts: 0 };
}

/**
 * Minimal PS demuxer for GB28181: extracts video (0xE0) and audio (0xC0) PES payloads.
 * Assumes payload carries AnnexB NAL (H.264/H.265) and raw AAC/G711/Opus.
 */
export function demuxPs(data: Uint8Array, state: PsDemuxerState, ctx: PsDemuxerContext): DemuxedFrame[] {
  void ctx;
  const frames: DemuxedFrame[] = [];
  let offset = 0;
  while (offset + 4 < data.length) {
    // search start code prefix 0x000001
    if (!(data[offset] === 0x00 && data[offset + 1] === 0x00 && data[offset + 2] === 0x01)) {
      offset++;
      continue;
    }
    const start = offset;
    const streamId = data[offset + 3];
    offset += 4;

    // pack header 0xBA
    if (streamId === 0xBA) {
      if (offset + 9 > data.length) break;
      const stuffingLen = data[offset + 9] & 0x07;
      offset += 10 + stuffingLen;
      continue;
    }
    // system header 0xBB
    if (streamId === 0xBB) {
      if (offset + 2 > data.length) break;
      const len = (data[offset] << 8) | data[offset + 1];
      offset += 2 + len;
      continue;
    }

    // PES
    if (offset + 2 > data.length) break;
    const pesLen = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    // pes_flags_1 currently unused in minimal parser
    const pesFlags2 = data[offset + 1];
    const headerLen = data[offset + 2];
    offset += 3;

    let pts = state.lastPts;
    const ptsDtsFlags = (pesFlags2 >> 6) & 0x03;
    if (ptsDtsFlags === 0x02 || ptsDtsFlags === 0x03) {
      pts = readPts(data, offset);
    }
    offset += headerLen;

    const payloadStart = offset;
    const packetEnd = pesLen > 0 ? Math.min(start + 6 + pesLen, data.length) : data.length;
    const payloadEnd = Math.min(packetEnd, data.length);
    const payload = data.subarray(payloadStart, payloadEnd);
    offset = packetEnd;
    state.lastPts = pts;

    if (streamId >= 0xE0 && streamId <= 0xEF) {
      frames.push({
        track: 'video',
        data: payload,
        pts,
        isKey: detectKeyframe(payload),
        codec: undefined
      });
    } else if (streamId >= 0xC0 && streamId <= 0xDF) {
      frames.push({
        track: 'audio',
        data: payload,
        pts,
        isKey: true
      });
    }
  }
  return frames;
}

function readPts(buf: Uint8Array, off: number): number {
  if (off + 4 >= buf.length) return 0;
  const p32_30 = (buf[off] >> 1) & 0x07;
  const p29_15 = (buf[off + 1] << 8) | buf[off + 2];
  const p14_0 = (buf[off + 3] << 8) | buf[off + 4];
  const pts90k = (p32_30 << 30) | ((p29_15 >> 1) << 15) | (p14_0 >> 1);
  return Math.floor(pts90k / 90);
}

function detectKeyframe(payload: Uint8Array): boolean {
  let i = 0;
  while (i + 4 < payload.length) {
    if (payload[i] === 0 && payload[i + 1] === 0 && payload[i + 2] === 1) {
      const nal = payload[i + 3];
      const nalTypeH264 = nal & 0x1f;
      if (nalTypeH264 === 5) return true;
      // HEVC start code might be 0x00 00 01 40/42/...; nal type bits 1..6
      const nalTypeH265 = (nal >> 1) & 0x3f;
      if (nalTypeH265 === 19 || nalTypeH265 === 20 || nalTypeH265 === 21) return true;
      i += 3;
    } else if (payload[i] === 0 && payload[i + 1] === 0 && payload[i + 2] === 0 && payload[i + 3] === 1) {
      const nal = payload[i + 4];
      const nalTypeH264 = nal & 0x1f;
      if (nalTypeH264 === 5) return true;
      const nalTypeH265 = (nal >> 1) & 0x3f;
      if (nalTypeH265 === 19 || nalTypeH265 === 20 || nalTypeH265 === 21) return true;
      i += 4;
    } else {
      i++;
    }
  }
  return false;
}
