/** Single format: u32 BE body length, then config (1), video (2) or optional raw metadata (3). No magic prefix. */
export const WEBTRANSPORT_MEDIA_PROTOCOL = 'fyra-media' as const;
export const DEFAULT_MAX_PACKET_BYTES = 2 * 1024 * 1024;
export const MAX_METADATA_BYTES = 65536;
export interface TransportVideoConfig {
  codec: string;
  codedWidth: number;
  codedHeight: number;
  /** AVCDecoderConfigurationRecord / HEVCDecoderConfigurationRecord bytes; absent means Annex B. */
  description?: number[];
}
export type TransportVideoPacket =
  | {kind:'config'; config:VideoDecoderConfig}
  | {kind:'video'; key:boolean; timestamp:number; duration?:number; data:Uint8Array}
  | {kind:'metadata'; type:'private-data' | 'sei'; timestamp:number; identifier?:number; data:Uint8Array};

/** Exact rounded conversion on the shared transport timeline; not original MPEG-TS PTS. */
export function transportTimestampToPts90k(timestamp:number):bigint {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new RangeError('Expected safe nonnegative microseconds');
  return (BigInt(timestamp) * 9n + 50n) / 100n;
}

function validateConfig(value: TransportVideoConfig): VideoDecoderConfig {
  if (!value || typeof value.codec !== 'string' || !/^(avc1|avc3|hvc1|hev1)\.[\w.]+$/.test(value.codec)
    || !Number.isInteger(value.codedWidth) || value.codedWidth < 1 || value.codedWidth > 8192
    || !Number.isInteger(value.codedHeight) || value.codedHeight < 1 || value.codedHeight > 8192
    || value.codedWidth * value.codedHeight > 33554432) throw new Error('Invalid H.264/H.265 video config');
  if (value.description && (!Array.isArray(value.description) || value.description.length > 16384
    || value.description.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255))) throw new Error('Invalid codec description');
  return {codec:value.codec, codedWidth:value.codedWidth, codedHeight:value.codedHeight,
    ...(value.description ? {description:Uint8Array.from(value.description)} : {})};
}

/** Incremental, bounded parser: handles arbitrary stream chunk splits/coalescing. */
export class TransportVideoParser {
  private header = new Uint8Array(4);
  private headerSize = 0;
  private body: Uint8Array | null = null;
  private bodySize = 0;
  private configured = false;
  private timestamp = -1;
  private metadataTimestamps = [-1,-1];
  constructor(private maxPacketBytes = DEFAULT_MAX_PACKET_BYTES) {
    if (!Number.isInteger(maxPacketBytes) || maxPacketBytes < 64 || maxPacketBytes > 16 * 1024 * 1024) throw new RangeError('Invalid maxPacketBytes');
  }
  *push(input: Uint8Array): Generator<TransportVideoPacket> {
    let offset = 0;
    while (offset < input.byteLength) {
      if (!this.body) {
        const count = Math.min(4 - this.headerSize, input.byteLength - offset);
        this.header.set(input.subarray(offset, offset + count), this.headerSize);
        this.headerSize += count; offset += count;
        if (this.headerSize < 4) continue;
        const length = new DataView(this.header.buffer).getUint32(0);
        if (length < 2 || length > this.maxPacketBytes) throw new Error('Video packet exceeds framing limits');
        this.body = new Uint8Array(length); this.bodySize = 0; this.headerSize = 0;
      }
      const count = Math.min(this.body.length - this.bodySize, input.byteLength - offset);
      // Inspect kind before copying/retaining a large payload. The overall record is bounded too.
      if (this.bodySize === 0 && input[offset] === 3 && this.body.length > MAX_METADATA_BYTES + 14) throw new Error('Metadata packet exceeds limits');
      this.body.set(input.subarray(offset, offset + count), this.bodySize);
      this.bodySize += count; offset += count;
      if (this.bodySize === this.body.length) {
        const body = this.body; this.body = null; this.bodySize = 0;
        if (body[0] === 1) {
          if (body.length > 65536) throw new Error('Video config exceeds limits');
          const config = validateConfig(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.subarray(1))));
          this.configured = true; this.timestamp = -1; this.metadataTimestamps = [-1,-1];
          yield {kind:'config',config};
        } else if (body[0] === 2) {
          if (!this.configured || body.length <= 14 || body[1] > 1) throw new Error('Invalid video packet or missing config');
          const view = new DataView(body.buffer);
          const pts = view.getBigUint64(2);
          if (pts > BigInt(Number.MAX_SAFE_INTEGER) || Number(pts) < this.timestamp) throw new Error('Video timestamps must be safe, nondecreasing microseconds');
          this.timestamp = Number(pts);
          const duration = view.getUint32(10);
          yield {kind:'video',key:body[1]===1,timestamp:this.timestamp,...(duration ? {duration} : {}),data:body.subarray(14)};
        } else if (body[0] === 3) {
          if (!this.configured || body.length <= 14 || (body[1] !== 1 && body[1] !== 2)) throw new Error('Invalid metadata packet or missing config');
          const view = new DataView(body.buffer);
          const pts = view.getBigUint64(2);
          const index = body[1] - 1;
          if (pts > BigInt(Number.MAX_SAFE_INTEGER) || Number(pts) < this.metadataTimestamps[index]) throw new Error('Metadata timestamps must be safe, nondecreasing microseconds per type');
          this.metadataTimestamps[index] = Number(pts);
          const identifier = view.getUint32(10);
          if (body[1] === 1 && identifier !== 0xffffffff && identifier > 8191) throw new Error('Invalid private-data PID');
          yield {kind:'metadata',type:body[1]===1?'private-data':'sei',timestamp:Number(pts),
            ...(identifier !== 0xffffffff ? {identifier} : {}),data:body.subarray(14)};
        } else throw new Error('Unknown video packet kind');
      }
    }
  }
  finish(): void {
    if (this.body || this.headerSize) throw new Error('Truncated video stream');
  }
}

function frame(body: Uint8Array): Uint8Array {
  const framed = new Uint8Array(body.length + 4);
  new DataView(framed.buffer).setUint32(0, body.length);
  framed.set(body,4); return framed;
}
/** Server/fixture encoders share the exact framing contract. */
export function encodeTransportConfig(config: TransportVideoConfig): Uint8Array {
  validateConfig(config);
  const json = new TextEncoder().encode(JSON.stringify(config));
  if (json.length + 1 > 65536) throw new Error('Video config exceeds limits');
  const body = new Uint8Array(json.length + 1); body[0] = 1; body.set(json,1); return frame(body);
}
export function encodeTransportChunk(packet: {key:boolean; timestamp:number; duration?:number; data:Uint8Array}): Uint8Array {
  if (!Number.isSafeInteger(packet.timestamp) || packet.timestamp < 0 || !packet.data.length
    || (packet.duration !== undefined && (!Number.isInteger(packet.duration) || packet.duration < 0 || packet.duration > 0xffffffff))) throw new Error('Invalid encoded video chunk');
  const body = new Uint8Array(packet.data.length + 14); body[0] = 2; body[1] = packet.key ? 1 : 0;
  const view = new DataView(body.buffer); view.setBigUint64(2,BigInt(packet.timestamp)); view.setUint32(10,packet.duration ?? 0);
  body.set(packet.data,14); return frame(body);
}

/** Optional complete raw private-data/KLV or SEI payloads, not TS/PES packets. */
export function encodeTransportMetadata(packet: {type:'private-data' | 'sei'; timestamp:number; identifier?:number; data:Uint8Array}): Uint8Array {
  transportTimestampToPts90k(packet.timestamp);
  if ((packet.type !== 'private-data' && packet.type !== 'sei') || !packet.data.length || packet.data.length > MAX_METADATA_BYTES
    || (packet.identifier !== undefined && (!Number.isInteger(packet.identifier) || packet.identifier < 0
      || packet.identifier > (packet.type === 'private-data' ? 8191 : 0xfffffffe)))) throw new Error('Invalid metadata packet');
  const body = new Uint8Array(packet.data.length + 14);body[0] = 3;body[1] = packet.type === 'private-data' ? 1 : 2;
  const view = new DataView(body.buffer);view.setBigUint64(2,BigInt(packet.timestamp));view.setUint32(10,packet.identifier ?? 0xffffffff);
  body.set(packet.data,14);return frame(body);
}
