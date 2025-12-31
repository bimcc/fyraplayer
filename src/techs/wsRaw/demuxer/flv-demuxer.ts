/**
 * FLV Demuxer
 * Handles FLV container format parsing for H.264/H.265 video and AAC/Opus audio
 */

import type { DemuxedFrame, DemuxerCallbacks } from './types.js';
import { extractAvcNalus, concatNalus } from './utils.js';
import { processSeiNalu, processHevcSeiNalu, type SeiProcessorState } from './sei.js';

export interface FlvDemuxerState {
  headerParsed: boolean;
  leftover: Uint8Array | null;
  audioDetected: boolean;
  aacConfig: Uint8Array | null;
  audioCodec: 'aac' | 'opus' | 'unknown' | null;
  opusHead: Uint8Array | null;
}

export interface FlvDemuxerContext {
  callbacks?: DemuxerCallbacks;
  seiState: SeiProcessorState;
}

export function createFlvState(): FlvDemuxerState {
  return {
    headerParsed: false,
    leftover: null,
    audioDetected: false,
    aacConfig: null,
    audioCodec: null,
    opusHead: null
  };
}

function concatLeftover(state: FlvDemuxerState, data: Uint8Array): Uint8Array {
  if (!state.leftover || state.leftover.byteLength === 0) return data;
  const out = new Uint8Array(state.leftover.byteLength + data.byteLength);
  out.set(state.leftover, 0);
  out.set(data, state.leftover.byteLength);
  state.leftover = null;
  return out;
}

export function demuxFlv(
  data: Uint8Array,
  state: FlvDemuxerState,
  ctx: FlvDemuxerContext
): DemuxedFrame[] {
  const frames: DemuxedFrame[] = [];
  let buf = concatLeftover(state, data);
  let offset = 0;

  if (!state.headerParsed) {
    if (buf.byteLength < 13) {
      state.leftover = buf;
      return frames;
    }
    offset = 13; // skip FLV header + prevTagSize0
    state.headerParsed = true;
  }

  while (offset + 11 <= buf.byteLength) {
    const tagType = buf[offset];
    const dataSize = (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
    const ts = (buf[offset + 4] << 16) | (buf[offset + 5] << 8) | buf[offset + 6] | (buf[offset + 7] << 24);
    const tagHeaderSize = 11;
    const totalSize = tagHeaderSize + dataSize + 4;

    if (offset + totalSize > buf.byteLength) break;

    const tagBody = buf.subarray(offset + tagHeaderSize, offset + tagHeaderSize + dataSize);

    if (tagType === 0x09 && dataSize > 5) {
      // Video tag
      const frame = parseVideoTag(tagBody, ts, ctx);
      if (frame) frames.push(frame);
    } else if (tagType === 0x08 && dataSize > 2) {
      // Audio tag
      const frame = parseAudioTag(tagBody, ts, state);
      if (frame) frames.push(frame);
    }

    offset += totalSize;
  }

  state.leftover = offset < buf.byteLength ? buf.subarray(offset) : null;
  return frames;
}


function parseVideoTag(
  tagBody: Uint8Array,
  ts: number,
  ctx: FlvDemuxerContext
): DemuxedFrame | null {
  const frameType = (tagBody[0] & 0xf0) >> 4;
  const codecId = tagBody[0] & 0x0f;

  if (codecId === 7) {
    // H.264/AVC
    return parseAvcTag(tagBody, ts, frameType, ctx);
  } else if (codecId === 12) {
    // H.265/HEVC
    return parseHevcTag(tagBody, ts, frameType, ctx);
  }

  return null;
}

function parseAvcTag(
  tagBody: Uint8Array,
  ts: number,
  frameType: number,
  ctx: FlvDemuxerContext
): DemuxedFrame | null {
  const avcPacketType = tagBody[1];
  const cts = (tagBody[2] << 16) | (tagBody[3] << 8) | tagBody[4];
  const payload = tagBody.subarray(5);

  if (avcPacketType !== 1) return null;

  const nalus = extractAvcNalus(payload);
  if (!nalus.length) return null;

  // Check for SEI NAL units
  if (ctx.callbacks?.onSEI || ctx.callbacks?.onSEIDetected) {
    for (const nalu of nalus) {
      if (nalu.length > 0) {
        const nalType = nalu[0] & 0x1f;
        if (nalType === 6) {
          processSeiNalu(nalu, ts + cts, ctx.callbacks, ctx.seiState);
        }
      }
    }
  }

  return {
    pts: ts + cts,
    data: concatNalus(nalus),
    isKey: frameType === 1 || nalus.some((n) => (n[0] & 0x1f) === 5),
    track: 'video'
  };
}

function parseHevcTag(
  tagBody: Uint8Array,
  ts: number,
  frameType: number,
  ctx: FlvDemuxerContext
): DemuxedFrame | null {
  const hevcPacketType = tagBody[1];
  const cts = (tagBody[2] << 16) | (tagBody[3] << 8) | tagBody[4];
  const payload = tagBody.subarray(5);

  if (hevcPacketType !== 1) return null;

  const nalus = extractAvcNalus(payload); // HEVC uses same length-prefixed format
  if (!nalus.length) return null;

  // Check for SEI NAL units (H.265 SEI types: 39 prefix, 40 suffix)
  if (ctx.callbacks?.onSEI || ctx.callbacks?.onSEIDetected) {
    for (const nalu of nalus) {
      if (nalu.length > 0) {
        const nalType = (nalu[0] >> 1) & 0x3f;
        if (nalType === 39 || nalType === 40) {
          processHevcSeiNalu(nalu, ts + cts, ctx.callbacks, ctx.seiState);
        }
      }
    }
  }

  return {
    pts: ts + cts,
    data: concatNalus(nalus),
    isKey: frameType === 1 || nalus.some((n) => {
      const nalType = (n[0] >> 1) & 0x3f;
      return nalType >= 16 && nalType <= 21; // HEVC IDR/CRA/BLA
    }),
    track: 'video'
  };
}

function parseAudioTag(
  tagBody: Uint8Array,
  ts: number,
  state: FlvDemuxerState
): DemuxedFrame | null {
  const soundFormat = (tagBody[0] & 0xf0) >> 4;
  const aacPacketType = tagBody[1];
  const payload = tagBody.subarray(2);

  if (soundFormat === 10) {
    // AAC
    if (aacPacketType === 0) {
      state.aacConfig = payload.slice();
      state.audioCodec = 'aac';
      return null;
    } else if (aacPacketType === 1) {
      state.audioDetected = true;
      return { pts: ts, data: payload.slice(), isKey: true, track: 'audio' };
    }
  } else if (soundFormat === 13) {
    // Opus
    state.audioDetected = true;
    state.audioCodec = 'opus';
    if (!state.opusHead) {
      state.opusHead = payload.slice();
      return null;
    } else {
      return { pts: ts, data: payload.slice(), isKey: true, track: 'audio' };
    }
  } else {
    state.audioDetected = true;
    state.audioCodec = 'unknown';
  }

  return null;
}
