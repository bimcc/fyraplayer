/**
 * MPEG-TS Demuxer
 * Handles MPEG-TS container format parsing for H.264/H.265 video, AAC audio, and private data
 */

import type { DemuxedFrame, DemuxerCallbacks, TsState } from './types.js';
import { splitAnnexBNalus, concatNalus, mergeChunks } from './utils.js';
import { processSeiNalu, type SeiProcessorState } from './sei.js';
import { getPrivateDataTypeName } from './private-data.js';

export interface TsDemuxerContext {
  callbacks?: DemuxerCallbacks;
  seiState: SeiProcessorState;
  manualPrivateDataPids?: number[];
  privateDataDetectOnly: boolean;
  extractionEnabled: boolean;
  detectedPrivateDataPids: Set<number>;
}

export function createTsState(): TsState {
  return {
    pmtPid: -1,
    videoPid: -1,
    audioPid: -1,
    patParsed: false,
    pmtParsed: false,
    videoPes: null,
    audioPes: null,
    privateDataPids: new Set(),
    privateDataPes: new Map(),
    privateDataStreamTypes: new Map()
  };
}

export interface TsDemuxerState {
  tsState: TsState;
  leftover: Uint8Array | null;
  audioDetected: boolean;
  aacConfig: Uint8Array | null;
  audioCodec: 'aac' | 'opus' | 'unknown' | null;
}

export function createTsDemuxerState(manualPids?: number[]): TsDemuxerState {
  const state: TsDemuxerState = {
    tsState: createTsState(),
    leftover: null,
    audioDetected: false,
    aacConfig: null,
    audioCodec: null
  };
  
  // Pre-populate manual PIDs
  if (manualPids) {
    for (const pid of manualPids) {
      state.tsState.privateDataPids.add(pid);
    }
  }
  
  return state;
}

function concatLeftover(state: TsDemuxerState, data: Uint8Array): Uint8Array {
  if (!state.leftover || state.leftover.byteLength === 0) return data;
  const out = new Uint8Array(state.leftover.byteLength + data.byteLength);
  out.set(state.leftover, 0);
  out.set(data, state.leftover.byteLength);
  state.leftover = null;
  return out;
}


export function demuxTs(
  data: Uint8Array,
  state: TsDemuxerState,
  ctx: TsDemuxerContext
): DemuxedFrame[] {
  const frames: DemuxedFrame[] = [];
  const packetSize = 188;
  const buf = concatLeftover(state, data);
  const usable = buf.byteLength - (buf.byteLength % packetSize);
  const ts = state.tsState;

  for (let off = 0; off + packetSize <= usable; off += packetSize) {
    const pkt = buf.subarray(off, off + packetSize);
    if (pkt[0] !== 0x47) continue;

    const payloadStart = (pkt[1] & 0x40) !== 0;
    const pid = ((pkt[1] & 0x1f) << 8) | pkt[2];
    const adaptation = (pkt[3] & 0x30) >> 4;
    let pos = 4;

    if (adaptation === 0 || adaptation === 2) continue;
    if (adaptation === 3) {
      const afl = pkt[pos];
      pos += 1 + afl;
    }
    if (pos >= pkt.length) continue;

    const payload = pkt.subarray(pos);

    // PAT
    if (pid === 0x0000) {
      parsePat(payload, payloadStart, ts);
      continue;
    }

    // PMT
    if (ts.pmtPid >= 0 && pid === ts.pmtPid) {
      parsePmt(payload, payloadStart, ts, state, ctx);
      continue;
    }

    // Video PID
    if (pid === ts.videoPid && ts.videoPid >= 0) {
      processVideoPes(payload, payloadStart, ts, frames, ctx);
    }

    // Audio PID
    if (pid === ts.audioPid && ts.audioPid >= 0) {
      processAudioPes(payload, payloadStart, ts, state, frames);
    }

    // Private Data PIDs
    if (ts.privateDataPids.has(pid) && ctx.callbacks?.onPrivateData) {
      processPrivateDataPes(payload, payloadStart, pid, ts, ctx);
    }
  }

  // Flush remaining PES buffers
  if (ts.videoPes && ts.videoPes.data.length > 5) {
    const flushed = flushVideoPes(ts, ctx);
    if (flushed) frames.push(flushed);
  }
  if (ts.audioPes && ts.audioPes.data.length > 0) {
    const flushed = flushAudioPes(ts, state);
    if (flushed) frames.push(flushed);
  }
  if (ctx.callbacks?.onPrivateData) {
    for (const pid of ts.privateDataPids) {
      const pesBuf = ts.privateDataPes.get(pid);
      if (pesBuf && pesBuf.data.length > 0) {
        flushPrivateDataPes(pid, ts, ctx);
      }
    }
  }

  state.leftover = usable < buf.byteLength ? buf.subarray(usable) : null;
  return frames;
}

function parsePat(payload: Uint8Array, payloadStart: boolean, ts: TsState): void {
  if (!payloadStart) return;
  let offset = 0;
  const pointer = payload[offset];
  offset += 1 + pointer;
  if (offset + 8 >= payload.byteLength) return;
  const tableId = payload[offset];
  if (tableId !== 0x00) return;
  offset += 1;
  const sectionLength = ((payload[offset] & 0x0f) << 8) | payload[offset + 1];
  offset += 2;
  offset += 5;
  const remaining = sectionLength - 5 - 4;
  const end = offset + remaining;
  while (offset + 4 <= end) {
    const programNumber = (payload[offset] << 8) | payload[offset + 1];
    const pmtPid = ((payload[offset + 2] & 0x1f) << 8) | payload[offset + 3];
    offset += 4;
    if (programNumber !== 0) {
      ts.pmtPid = pmtPid;
      ts.patParsed = true;
      break;
    }
  }
}


function parsePmt(
  payload: Uint8Array,
  payloadStart: boolean,
  ts: TsState,
  state: TsDemuxerState,
  ctx: TsDemuxerContext
): void {
  if (!payloadStart) return;
  let offset = 0;
  const pointer = payload[offset];
  offset += 1 + pointer;
  if (offset + 12 >= payload.byteLength) return;
  const tableId = payload[offset];
  if (tableId !== 0x02) return;
  offset += 1;
  const sectionLength = ((payload[offset] & 0x0f) << 8) | payload[offset + 1];
  offset += 2;
  offset += 5;
  const pcrPid = ((payload[offset] & 0x1f) << 8) | payload[offset + 1];
  offset += 2;
  const programInfoLength = ((payload[offset] & 0x0f) << 8) | payload[offset + 1];
  offset += 2 + programInfoLength;
  const sectionEnd = offset + (sectionLength - 9 - programInfoLength - 4);

  while (offset + 5 <= sectionEnd && offset + 5 <= payload.byteLength) {
    const streamType = payload[offset];
    const elementaryPid = ((payload[offset + 1] & 0x1f) << 8) | payload[offset + 2];
    const esInfoLength = ((payload[offset + 3] & 0x0f) << 8) | payload[offset + 4];
    offset += 5 + esInfoLength;

    // H.264 (0x1b) or H.265 (0x24)
    if (streamType === 0x1b || streamType === 0x24) {
      ts.videoPid = elementaryPid;
      ts.pmtParsed = true;
    }

    // AAC (0x0f ADTS, 0x11 LATM) or MP3 (0x03, 0x04)
    if (streamType === 0x0f || streamType === 0x11 || streamType === 0x03 || streamType === 0x04) {
      ts.audioPid = elementaryPid;
      state.audioDetected = true;
      state.audioCodec = (streamType === 0x0f || streamType === 0x11) ? 'aac' : 'unknown';
    }

    // Private data streams: 0x06 (PES private data) and 0x15 (metadata in PES)
    if ((streamType === 0x06 || streamType === 0x15) && 
        (ctx.callbacks?.onPrivateData || ctx.callbacks?.onPrivateDataDetected)) {
      if (!ctx.manualPrivateDataPids || ctx.manualPrivateDataPids.length === 0) {
        if (!ts.privateDataPids.has(elementaryPid)) {
          ts.privateDataPids.add(elementaryPid);
          ts.privateDataStreamTypes.set(elementaryPid, streamType);

          const streamTypeName = getPrivateDataTypeName(streamType);
          console.log(`[demuxer] 🔍 Detected private data: PID=0x${elementaryPid.toString(16).toUpperCase()} (${streamTypeName}, stream_type=0x${streamType.toString(16).toUpperCase()})`);

          if (!ctx.detectedPrivateDataPids.has(elementaryPid)) {
            ctx.detectedPrivateDataPids.add(elementaryPid);
            try {
              ctx.callbacks?.onPrivateDataDetected?.(elementaryPid, streamType);
            } catch (err) {
              console.warn('[demuxer] onPrivateDataDetected callback error:', err);
            }
          }
        }
      }
    }
  }
  void pcrPid;
}

function parsePes(payload: Uint8Array): { headerLen: number; ptsMs?: number } | null {
  if (payload.byteLength < 9) return null;
  if (!(payload[0] === 0x00 && payload[1] === 0x00 && payload[2] === 0x01)) return null;
  const flags = payload[7];
  const headerDataLen = payload[8];
  let ptsMs: number | undefined;
  if ((flags & 0x80) !== 0 && headerDataLen >= 5) {
    const pts =
      ((payload[9] & 0x0e) << 29) |
      (payload[10] << 22) |
      ((payload[11] & 0xfe) << 14) |
      (payload[12] << 7) |
      ((payload[13] & 0xfe) >> 1);
    ptsMs = Math.round(pts / 90);
  }
  return { headerLen: 9 + headerDataLen, ptsMs };
}


function processVideoPes(
  payload: Uint8Array,
  payloadStart: boolean,
  ts: TsState,
  frames: DemuxedFrame[],
  ctx: TsDemuxerContext
): void {
  let data = payload;
  if (payloadStart) {
    if (ts.videoPes && ts.videoPes.data.length) {
      const flushed = flushVideoPes(ts, ctx);
      if (flushed) frames.push(flushed);
    }
    const header = parsePes(data);
    if (!header) return;
    data = data.subarray(header.headerLen);
    ts.videoPes = { pts: header.ptsMs ?? 0, data: [] };
  }
  if (ts.videoPes && data.byteLength) {
    ts.videoPes.data.push(data);
  }
}

function processAudioPes(
  payload: Uint8Array,
  payloadStart: boolean,
  ts: TsState,
  state: TsDemuxerState,
  frames: DemuxedFrame[]
): void {
  let data = payload;
  if (payloadStart) {
    if (ts.audioPes && ts.audioPes.data.length) {
      const flushed = flushAudioPes(ts, state);
      if (flushed) frames.push(flushed);
    }
    const header = parsePes(data);
    if (!header) return;
    data = data.subarray(header.headerLen);
    ts.audioPes = { pts: header.ptsMs ?? 0, data: [] };
  }
  if (ts.audioPes && data.byteLength) {
    ts.audioPes.data.push(data);
  }
}

function processPrivateDataPes(
  payload: Uint8Array,
  payloadStart: boolean,
  pid: number,
  ts: TsState,
  ctx: TsDemuxerContext
): void {
  let data = payload;
  if (payloadStart) {
    const existingPes = ts.privateDataPes.get(pid);
    if (existingPes && existingPes.data.length) {
      flushPrivateDataPes(pid, ts, ctx);
    }
    const header = parsePes(data);
    if (!header) return;
    data = data.subarray(header.headerLen);
    ts.privateDataPes.set(pid, { pts: header.ptsMs ?? 0, data: [] });
  }
  const pesBuf = ts.privateDataPes.get(pid);
  if (pesBuf && data.byteLength) {
    pesBuf.data.push(data);
  }
}

function flushVideoPes(ts: TsState, ctx: TsDemuxerContext): DemuxedFrame | null {
  const pes = ts.videoPes;
  ts.videoPes = null;
  if (!pes || !pes.data.length) return null;
  const payload = mergeChunks(pes.data);
  const nalus = splitAnnexBNalus(payload);
  if (!nalus.length) return null;

  // Check for SEI NAL units
  if (ctx.callbacks?.onSEI || ctx.callbacks?.onSEIDetected) {
    for (const nalu of nalus) {
      if (nalu.length > 0) {
        const nalType = nalu[0] & 0x1f;
        if (nalType === 6) {
          processSeiNalu(nalu, pes.pts || 0, ctx.callbacks, ctx.seiState);
        }
      }
    }
  }

  return {
    pts: pes.pts || 0,
    data: concatNalus(nalus),
    isKey: nalus.some((n) => (n[0] & 0x1f) === 5),
    track: 'video'
  };
}

function flushAudioPes(ts: TsState, state: TsDemuxerState): DemuxedFrame | null {
  const pes = ts.audioPes;
  ts.audioPes = null;
  if (!pes || !pes.data.length) return null;
  const payload = mergeChunks(pes.data);
  if (!payload.byteLength) return null;

  // Extract AAC config from ADTS header
  if (!state.aacConfig && payload.byteLength >= 7) {
    if ((payload[0] === 0xff) && ((payload[1] & 0xf0) === 0xf0)) {
      const profile = ((payload[2] & 0xc0) >> 6) + 1;
      const sampleRateIdx = (payload[2] & 0x3c) >> 2;
      const channels = ((payload[2] & 0x01) << 2) | ((payload[3] & 0xc0) >> 6);
      state.aacConfig = new Uint8Array([
        (profile << 3) | ((sampleRateIdx & 0x0e) >> 1),
        ((sampleRateIdx & 0x01) << 7) | (channels << 3)
      ]);
    }
  }

  return { pts: pes.pts || 0, data: payload, isKey: true, track: 'audio' };
}

function flushPrivateDataPes(pid: number, ts: TsState, ctx: TsDemuxerContext): void {
  const pes = ts.privateDataPes.get(pid);
  ts.privateDataPes.delete(pid);
  if (!pes || !pes.data.length) return;
  const payload = mergeChunks(pes.data);
  if (!payload.byteLength) return;

  const streamType = ts.privateDataStreamTypes.get(pid);
  const streamTypeName = streamType ? getPrivateDataTypeName(streamType) : 'Unknown';

  if (ctx.privateDataDetectOnly && !ctx.extractionEnabled) {
    console.log(`[demuxer] 📦 Private data available: PID=0x${pid.toString(16).toUpperCase()} (${streamTypeName}), ${payload.length} bytes @ PTS ${pes.pts}ms [extraction disabled]`);
    return;
  }

  console.log(`[demuxer] 📤 Extracting private data: PID=0x${pid.toString(16).toUpperCase()} (${streamTypeName}), ${payload.length} bytes @ PTS ${pes.pts}ms`);

  try {
    ctx.callbacks?.onPrivateData?.(pid, payload, pes.pts || 0);
  } catch (err) {
    console.warn('[demuxer] onPrivateData callback error:', err);
  }
}
