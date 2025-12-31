/**
 * Demuxer Utilities
 * Common utility functions for demuxing
 */

/**
 * Utility: split AnnexB by start codes into individual NALU buffers.
 */
export function splitAnnexBNalus(data: Uint8Array): Uint8Array[] {
  const nalus: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i + 3 < data.length; i++) {
    const four = data[i] === 0x00 && data[i + 1] === 0x00 && data[i + 2] === 0x00 && data[i + 3] === 0x01;
    const three = data[i] === 0x00 && data[i + 1] === 0x00 && data[i + 2] === 0x01;
    if (four) {
      if (start >= 0 && i > start) nalus.push(data.subarray(start, i));
      start = i + 4;
    } else if (three) {
      if (start >= 0 && i > start) nalus.push(data.subarray(start, i));
      start = i + 3;
    }
  }
  if (start >= 0 && start < data.length) {
    nalus.push(data.subarray(start));
  } else if (start === -1 && data.length) {
    nalus.push(data);
  }
  return nalus;
}

/**
 * Concatenate NALUs with AnnexB start codes
 */
export function concatNalus(list: Uint8Array[]): Uint8Array {
  const total = list.reduce((sum, n) => sum + 4 + n.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const n of list) {
    out.set([0, 0, 0, 1], offset);
    offset += 4;
    out.set(n, offset);
    offset += n.byteLength;
  }
  return out;
}

/**
 * Concatenate leftover buffer with new data
 */
export function concatLeftover(leftover: Uint8Array | null, data: Uint8Array): Uint8Array {
  if (!leftover || leftover.byteLength === 0) return data;
  const out = new Uint8Array(leftover.byteLength + data.byteLength);
  out.set(leftover, 0);
  out.set(data, leftover.byteLength);
  return out;
}

/**
 * Merge multiple chunks into a single Uint8Array
 */
export function mergeChunks(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.byteLength, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/**
 * Extract AVC NALUs from length-prefixed format (AVCC)
 */
export function extractAvcNalus(payload: Uint8Array): Uint8Array[] {
  const nalus: Uint8Array[] = [];
  let offset = 0;
  while (offset + 4 <= payload.byteLength) {
    const size =
      (payload[offset] << 24) | (payload[offset + 1] << 16) | (payload[offset + 2] << 8) | payload[offset + 3];
    offset += 4;
    if (offset + size > payload.byteLength) break;
    nalus.push(payload.subarray(offset, offset + size));
    offset += size;
  }
  return nalus;
}

/**
 * Extract HEVC NALUs from HVCC format (same as AVC in FLV)
 */
export function extractHevcNalus(payload: Uint8Array): Uint8Array[] {
  return extractAvcNalus(payload);
}
