/**
 * SEI (Supplemental Enhancement Information) Processing
 * Handles H.264 and H.265 SEI NAL unit parsing
 */

import type { DemuxerCallbacks } from './types.js';

/**
 * Get human-readable name for SEI payload type
 */
export function getSeiTypeName(seiType: number): string {
  switch (seiType) {
    case 0: return 'Buffering Period';
    case 1: return 'Picture Timing';
    case 2: return 'Pan Scan Rect';
    case 3: return 'Filler Payload';
    case 4: return 'User Data Registered (ITU-T T.35)';
    case 5: return 'User Data Unregistered';
    case 6: return 'Recovery Point';
    case 7: return 'Dec Ref Pic Marking Repetition';
    case 8: return 'Spare Pic';
    case 9: return 'Scene Info';
    case 10: return 'Sub Seq Info';
    case 11: return 'Sub Seq Layer Characteristics';
    case 12: return 'Sub Seq Characteristics';
    case 13: return 'Full Frame Freeze';
    case 14: return 'Full Frame Freeze Release';
    case 15: return 'Full Frame Snapshot';
    case 16: return 'Progressive Refinement Segment Start';
    case 17: return 'Progressive Refinement Segment End';
    case 18: return 'Motion Constrained Slice Group Set';
    case 19: return 'Film Grain Characteristics';
    case 20: return 'Deblocking Filter Display Preference';
    case 21: return 'Stereo Video Info';
    case 22: return 'Post Filter Hint';
    case 23: return 'Tone Mapping Info';
    case 45: return 'Frame Packing Arrangement';
    case 47: return 'Display Orientation';
    case 128: return 'SMPTE ST 2094-10';
    case 137: return 'Mastering Display Colour Volume';
    case 144: return 'Content Light Level Info';
    case 147: return 'Alternative Transfer Characteristics';
    default: return `Unknown (${seiType})`;
  }
}

export interface SeiProcessorState {
  detectedSeiTypes: Set<number>;
  seiDetectOnly: boolean;
  extractionEnabled: boolean;
}

/**
 * Process H.264 SEI NAL unit and invoke callback for each SEI message
 * H.264 SEI structure: nal_unit_type (6) + sei_message(s)
 * Each sei_message: payloadType + payloadSize + payload
 */
export function processSeiNalu(
  nalu: Uint8Array,
  pts: number,
  callbacks: DemuxerCallbacks | undefined,
  state: SeiProcessorState
): void {
  if (nalu.length < 2) return;
  
  let offset = 1; // Skip NAL header byte
  
  while (offset < nalu.length) {
    // Parse payload type (variable length)
    let payloadType = 0;
    while (offset < nalu.length && nalu[offset] === 0xff) {
      payloadType += 255;
      offset++;
    }
    if (offset >= nalu.length) break;
    payloadType += nalu[offset++];
    
    // Parse payload size (variable length)
    let payloadSize = 0;
    while (offset < nalu.length && nalu[offset] === 0xff) {
      payloadSize += 255;
      offset++;
    }
    if (offset >= nalu.length) break;
    payloadSize += nalu[offset++];
    
    // Extract payload
    if (offset + payloadSize > nalu.length) break;
    const payload = nalu.subarray(offset, offset + payloadSize);
    offset += payloadSize;
    
    // Track detected SEI types
    const isNewType = !state.detectedSeiTypes.has(payloadType);
    if (isNewType) {
      state.detectedSeiTypes.add(payloadType);
      const seiTypeName = getSeiTypeName(payloadType);
      console.log(`[demuxer] 🔍 Detected SEI: type=${payloadType} (${seiTypeName}), ${payloadSize} bytes`);
      
      // Notify detection callback
      try {
        callbacks?.onSEIDetected?.(payloadType);
      } catch (err) {
        console.warn('[demuxer] onSEIDetected callback error:', err);
      }
    }
    
    // In detect-only mode or extraction disabled, skip extraction
    if (state.seiDetectOnly && !state.extractionEnabled) {
      continue;
    }
    
    // Full extraction mode - invoke callback
    try {
      callbacks?.onSEI?.(payload, pts, payloadType);
    } catch (err) {
      console.warn('[demuxer] onSEI callback error:', err);
    }
    
    // Check for RBSP trailing bits (0x80 followed by zeros)
    if (offset < nalu.length && nalu[offset] === 0x80) {
      break;
    }
  }
}

/**
 * Process HEVC SEI NAL unit
 * H.265 SEI structure differs from H.264 - NAL header is 2 bytes
 */
export function processHevcSeiNalu(
  nalu: Uint8Array,
  pts: number,
  callbacks: DemuxerCallbacks | undefined,
  state: SeiProcessorState
): void {
  if (nalu.length < 3) return;
  
  let offset = 2; // Skip 2-byte NAL header for HEVC
  
  while (offset < nalu.length) {
    // Parse payload type (variable length)
    let payloadType = 0;
    while (offset < nalu.length && nalu[offset] === 0xff) {
      payloadType += 255;
      offset++;
    }
    if (offset >= nalu.length) break;
    payloadType += nalu[offset++];
    
    // Parse payload size (variable length)
    let payloadSize = 0;
    while (offset < nalu.length && nalu[offset] === 0xff) {
      payloadSize += 255;
      offset++;
    }
    if (offset >= nalu.length) break;
    payloadSize += nalu[offset++];
    
    // Extract payload
    if (offset + payloadSize > nalu.length) break;
    const payload = nalu.subarray(offset, offset + payloadSize);
    offset += payloadSize;
    
    // Track detected SEI types
    const isNewType = !state.detectedSeiTypes.has(payloadType);
    if (isNewType) {
      state.detectedSeiTypes.add(payloadType);
      const seiTypeName = getSeiTypeName(payloadType);
      console.log(`[demuxer] 🔍 Detected HEVC SEI: type=${payloadType} (${seiTypeName}), ${payloadSize} bytes`);
      
      try {
        callbacks?.onSEIDetected?.(payloadType);
      } catch (err) {
        console.warn('[demuxer] onSEIDetected callback error:', err);
      }
    }
    
    // In detect-only mode or extraction disabled, skip extraction
    if (state.seiDetectOnly && !state.extractionEnabled) {
      continue;
    }
    
    // Full extraction mode - invoke callback
    try {
      callbacks?.onSEI?.(payload, pts, payloadType);
    } catch (err) {
      console.warn('[demuxer] onSEI callback error:', err);
    }
    
    // Check for RBSP trailing bits
    if (offset < nalu.length && nalu[offset] === 0x80) {
      break;
    }
  }
}
