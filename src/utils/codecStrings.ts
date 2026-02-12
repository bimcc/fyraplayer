import { splitAnnexBNalus } from '../techs/wsRaw/demuxer/utils.js';

/**
 * Codec string utilities for H.264/H.265.
 * Parses SPS/VPS to derive codec strings that match the encoded bitstream.
 */

/**
 * Remove emulation prevention bytes (0x03 after 0x0000) from RBSP.
 */
function removeEmulationBytes(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i > 1 && data[i] === 0x03 && data[i - 1] === 0x00 && data[i - 2] === 0x00) {
      continue;
    }
    out.push(data[i]);
  }
  return new Uint8Array(out);
}

class BitReader {
  private offset = 0;
  constructor(private readonly data: Uint8Array) {}

  readBits(count: number): number {
    if (count <= 0) return 0;
    let value = 0;
    for (let i = 0; i < count; i++) {
      if (this.offset >= this.data.length * 8) {
        throw new Error('out of range');
      }
      const byte = this.data[this.offset >> 3];
      const bit = 7 - (this.offset & 7);
      value = (value << 1) | ((byte >> bit) & 0x01);
      this.offset++;
    }
    return value;
  }

  skipBits(count: number): void {
    this.offset = Math.min(this.offset + count, this.data.length * 8);
  }

  bitsLeft(): number {
    return this.data.length * 8 - this.offset;
  }
}

function toHex(value: number, width = 2): string {
  return value.toString(16).toUpperCase().padStart(width, '0');
}

function trimHex(value: bigint | number, minWidth = 1): string {
  const hex = (typeof value === 'bigint' ? value.toString(16) : value.toString(16)).toUpperCase();
  const trimmed = hex.replace(/^0+/, '');
  return (trimmed.length ? trimmed : '0').padStart(minWidth, '0');
}

/**
 * Build avc1 codec string from SPS (Annex-B or RBSP).
 */
export function parseH264CodecFromSps(sps: Uint8Array): string | null {
  // Expect NAL header + profile_idc + constraint_set flags + level_idc
  if (!sps || sps.length < 4) return null;
  // Skip Annex-B start code if present
  let start = 0;
  if (sps[0] === 0x00 && sps[1] === 0x00) {
    for (let i = 2; i < sps.length - 1; i++) {
      if (sps[i] === 0x01) {
        start = i + 1;
        break;
      }
    }
  }
  const nal = sps.subarray(start);
  if (nal.length < 4) return null;
  const profileIdc = nal[1];
  const compatibility = nal[2];
  const levelIdc = nal[3];
  return `avc1.${toHex(profileIdc)}${toHex(compatibility)}${toHex(levelIdc)}`;
}

interface HevcProfileInfo {
  profileSpace: number;
  tierFlag: number;
  profileIdc: number;
  profileCompatibility: number;
  constraintIndicator: bigint;
  levelIdc: number;
}

function parseHevcProfileTierLevel(rbsp: Uint8Array, skipLeadingBits: number): HevcProfileInfo | null {
  const br = new BitReader(rbsp);
  br.skipBits(skipLeadingBits);
  if (br.bitsLeft() < 96) return null;
  const profileSpace = br.readBits(2);
  const tierFlag = br.readBits(1);
  const profileIdc = br.readBits(5);
  let compatibility = 0;
  for (let i = 0; i < 4; i++) {
    compatibility = (compatibility << 8) | br.readBits(8);
  }
  let constraint = 0n;
  for (let i = 0; i < 6; i++) {
    constraint = (constraint << 8n) | BigInt(br.readBits(8));
  }
  const levelIdc = br.readBits(8);
  return { profileSpace, tierFlag, profileIdc, profileCompatibility: compatibility, constraintIndicator: constraint, levelIdc };
}

function formatHevcCodec(info: HevcProfileInfo, prefix: 'hvc1' | 'hev1' = 'hvc1'): string {
  const profileSpaceTag = ['', 'A', 'B', 'C'][info.profileSpace] ?? '';
  const compatHex = trimHex(info.profileCompatibility);
  const constraintHex = trimHex(info.constraintIndicator);
  const tierChar = info.tierFlag ? 'H' : 'L';
  const level = info.levelIdc.toString();
  const constraintPart = constraintHex ? constraintHex : '0';
  return `${prefix}.${profileSpaceTag}${info.profileIdc}.${compatHex}.${tierChar}${level}.${constraintPart}`;
}

/**
 * Parse HEVC codec string from VPS/SPS (Annex-B).
 * Prefers VPS if present, otherwise SPS.
 */
export function parseH265CodecFromNalus(nalus: Uint8Array[], prefix: 'hvc1' | 'hev1' = 'hvc1'): string | null {
  const findNal = (types: number[]) => nalus.find((n) => types.includes(((n[0] >> 1) & 0x3f)));
  const vps = findNal([32]);
  const sps = findNal([33]);
  const src = vps || sps;
  if (!src || src.length < 6) return null;
  const rbsp = removeEmulationBytes(src.subarray(2));
  // VPS: skip 4 bits vps_video_parameter_set_id, 1 base_layer_internal, 1 base_layer_available, 6 max_layers_minus1,
  // 3 max_sub_layers_minus1, 1 temporal_id_nesting_flag => 16 bits, then profile_tier_level
  // SPS: skip 4 bits vps_id, 3 max_sub_layers_minus1, 1 temporal_id_nesting_flag => 8 bits, then profile_tier_level
  const skipBits = ((src[0] >> 1) & 0x3f) === 32 ? 16 : 8;
  try {
    const info = parseHevcProfileTierLevel(rbsp, skipBits);
    if (!info) return null;
    return formatHevcCodec(info, prefix);
  } catch {
    return null;
  }
}

/**
 * Derive codec string from Annex-B video frame.
 * Uses codec hint to choose parser; falls back to null on failure.
 */
export function deriveCodecFromAnnexB(frameData: Uint8Array, hint?: 'h264' | 'h265'): string | null {
  const nalus = splitAnnexBNalus(frameData);
  const codec = hint || detectCodecFromNalus(nalus);
  if (codec === 'h264') {
    const sps = nalus.find((n) => (n[0] & 0x1f) === 7);
    return sps ? parseH264CodecFromSps(sps) : null;
  }
  if (codec === 'h265') {
    return parseH265CodecFromNalus(nalus);
  }
  return null;
}

function detectCodecFromNalus(nalus: Uint8Array[]): 'h264' | 'h265' | null {
  for (const n of nalus) {
    const h264Type = n[0] & 0x1f;
    const h265Type = (n[0] >> 1) & 0x3f;
    if (h264Type === 7 || h264Type === 5) return 'h264';
    if (h265Type === 32 || h265Type === 33) return 'h265';
  }
  return null;
}
