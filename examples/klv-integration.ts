/**
 * KLV Integration Example
 * 
 * This example demonstrates how to integrate KLV metadata extraction
 * with FyraPlayer for real-time and offline processing.
 * 
 * Prerequisites:
 * - npm install @beeviz/klv (or your preferred KLV parser)
 */

import { MetadataEvent, WSRawSource } from '../src/types.js';

// ============================================================================
// Type Definitions (for demonstration - use @beeviz/klv types in production)
// ============================================================================

interface KlvPacket {
  key: Uint8Array;
  length: number;
  value: Uint8Array;
}

interface Misb0601Data {
  timestamp?: number;
  missionId?: string;
  platformTailNumber?: string;
  platformHeading?: number;
  platformPitch?: number;
  platformRoll?: number;
  sensorLatitude?: number;
  sensorLongitude?: number;
  sensorAltitude?: number;
  sensorHorizontalFov?: number;
  sensorVerticalFov?: number;
  targetLatitude?: number;
  targetLongitude?: number;
  targetElevation?: number;
  slantRange?: number;
  [key: string]: unknown;
}

// ============================================================================
// Mock KLV Parser (replace with @beeviz/klv in production)
// ============================================================================

class MockKlvParser {
  /**
   * Parse KLV data from raw bytes
   */
  parse(data: Uint8Array): KlvPacket[] {
    const packets: KlvPacket[] = [];
    let offset = 0;
    
    while (offset < data.length) {
      // Check for MISB 0601 Universal Key (16 bytes)
      if (offset + 16 > data.length) break;
      
      const key = data.subarray(offset, offset + 16);
      offset += 16;
      
      // Parse BER length
      if (offset >= data.length) break;
      let length = data[offset++];
      
      if (length & 0x80) {
        const numBytes = length & 0x7f;
        length = 0;
        for (let i = 0; i < numBytes && offset < data.length; i++) {
          length = (length << 8) | data[offset++];
        }
      }
      
      if (offset + length > data.length) break;
      
      const value = data.subarray(offset, offset + length);
      offset += length;
      
      packets.push({ key, length, value });
    }
    
    return packets;
  }
}

// MISB 0601 Universal Key
const MISB_0601_KEY = new Uint8Array([
  0x06, 0x0e, 0x2b, 0x34, 0x02, 0x0b, 0x01, 0x01,
  0x0e, 0x01, 0x03, 0x01, 0x01, 0x00, 0x00, 0x00
]);

function isMisb0601Key(key: Uint8Array): boolean {
  if (key.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (key[i] !== MISB_0601_KEY[i]) return false;
  }
  return true;
}

// ============================================================================
// Example 1: Real-time Stream Processing
// ============================================================================

/**
 * Example configuration for real-time KLV extraction
 */
export function createKlvEnabledSource(url: string): WSRawSource {
  return {
    type: 'ws-raw',
    url,
    codec: 'h264',
    transport: 'ts',
    experimental: true,
    metadata: {
      privateData: {
        enable: true
        // pids: [0x0102]  // Uncomment to manually specify PID
      },
      sei: {
        enable: true
      }
    }
  };
}

/**
 * KLV metadata handler for real-time processing
 */
export class KlvMetadataHandler {
  private parser = new MockKlvParser();
  private lastPosition: { lat: number; lng: number; alt: number } | null = null;
  private onPositionUpdate?: (pos: { lat: number; lng: number; alt: number; pts: number }) => void;
  
  constructor(options?: {
    onPositionUpdate?: (pos: { lat: number; lng: number; alt: number; pts: number }) => void;
  }) {
    this.onPositionUpdate = options?.onPositionUpdate;
  }
  
  /**
   * Handle metadata event from FyraPlayer
   */
  handleMetadataEvent(event: MetadataEvent): void {
    if (event.type !== 'private-data') return;
    
    try {
      const packets = this.parser.parse(event.raw);
      
      for (const packet of packets) {
        if (isMisb0601Key(packet.key)) {
          const decoded = this.decodeMisb0601(packet.value);
          this.processDecodedData(decoded, event.pts);
        }
      }
    } catch (err) {
      console.warn('[KlvHandler] Parse error:', err);
    }
  }
  
  /**
   * Decode MISB 0601 Local Set
   * Note: This is a simplified decoder. Use @beeviz/klv for full implementation.
   */
  private decodeMisb0601(value: Uint8Array): Misb0601Data {
    const data: Misb0601Data = {};
    let offset = 0;
    
    while (offset < value.length) {
      const tag = value[offset++];
      if (offset >= value.length) break;
      
      let length = value[offset++];
      if (offset + length > value.length) break;
      
      const tagValue = value.subarray(offset, offset + length);
      offset += length;
      
      // Decode common tags (simplified)
      switch (tag) {
        case 2: // Timestamp
          data.timestamp = this.decodeTimestamp(tagValue);
          break;
        case 3: // Mission ID
          data.missionId = new TextDecoder().decode(tagValue);
          break;
        case 5: // Platform Heading
          data.platformHeading = this.decodeAngle(tagValue, 360);
          break;
        case 13: // Sensor Latitude
          data.sensorLatitude = this.decodeLatitude(tagValue);
          break;
        case 14: // Sensor Longitude
          data.sensorLongitude = this.decodeLongitude(tagValue);
          break;
        case 15: // Sensor Altitude
          data.sensorAltitude = this.decodeAltitude(tagValue);
          break;
        case 40: // Target Latitude
          data.targetLatitude = this.decodeLatitude(tagValue);
          break;
        case 41: // Target Longitude
          data.targetLongitude = this.decodeLongitude(tagValue);
          break;
      }
    }
    
    return data;
  }
  
  private decodeTimestamp(value: Uint8Array): number {
    let result = 0;
    for (let i = 0; i < value.length; i++) {
      result = (result << 8) | value[i];
    }
    return result;
  }
  
  private decodeAngle(value: Uint8Array, range: number): number {
    let raw = 0;
    for (let i = 0; i < value.length; i++) {
      raw = (raw << 8) | value[i];
    }
    const maxVal = (1 << (value.length * 8)) - 1;
    return (raw / maxVal) * range;
  }
  
  private decodeLatitude(value: Uint8Array): number {
    let raw = 0;
    for (let i = 0; i < value.length; i++) {
      raw = (raw << 8) | value[i];
    }
    // Convert to signed
    if (raw & (1 << (value.length * 8 - 1))) {
      raw -= 1 << (value.length * 8);
    }
    const maxVal = (1 << (value.length * 8 - 1)) - 1;
    return (raw / maxVal) * 90;
  }
  
  private decodeLongitude(value: Uint8Array): number {
    let raw = 0;
    for (let i = 0; i < value.length; i++) {
      raw = (raw << 8) | value[i];
    }
    if (raw & (1 << (value.length * 8 - 1))) {
      raw -= 1 << (value.length * 8);
    }
    const maxVal = (1 << (value.length * 8 - 1)) - 1;
    return (raw / maxVal) * 180;
  }
  
  private decodeAltitude(value: Uint8Array): number {
    let raw = 0;
    for (let i = 0; i < value.length; i++) {
      raw = (raw << 8) | value[i];
    }
    // MISB 0601 altitude: -900 to 19000 meters
    const maxVal = (1 << (value.length * 8)) - 1;
    return -900 + (raw / maxVal) * 19900;
  }
  
  private processDecodedData(data: Misb0601Data, pts: number): void {
    // Update position if available
    if (data.sensorLatitude !== undefined && data.sensorLongitude !== undefined) {
      this.lastPosition = {
        lat: data.sensorLatitude,
        lng: data.sensorLongitude,
        alt: data.sensorAltitude ?? 0
      };
      
      this.onPositionUpdate?.({
        ...this.lastPosition,
        pts
      });
    }
    
    // Log decoded data
    console.log(`[KLV @ ${pts}ms]`, data);
  }
  
  getLastPosition() {
    return this.lastPosition;
  }
}

// ============================================================================
// Example 2: SEI Data Processing
// ============================================================================

/**
 * SEI metadata handler
 */
export class SeiMetadataHandler {
  /**
   * Handle SEI metadata event
   */
  handleMetadataEvent(event: MetadataEvent): void {
    if (event.type !== 'sei') return;
    
    switch (event.seiType) {
      case 5: // User Data Unregistered
        this.handleUnregisteredUserData(event.raw, event.pts);
        break;
      case 4: // User Data Registered (ITU-T T.35)
        this.handleRegisteredUserData(event.raw, event.pts);
        break;
      default:
        console.log(`[SEI] Type ${event.seiType} at PTS ${event.pts}ms, ${event.raw.length} bytes`);
    }
  }
  
  private handleUnregisteredUserData(data: Uint8Array, pts: number): void {
    if (data.length < 16) return;
    
    // First 16 bytes are UUID
    const uuid = Array.from(data.subarray(0, 16))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    const payload = data.subarray(16);
    
    console.log(`[SEI Unregistered] UUID: ${uuid}, PTS: ${pts}ms, Payload: ${payload.length} bytes`);
  }
  
  private handleRegisteredUserData(data: Uint8Array, pts: number): void {
    if (data.length < 3) return;
    
    // ITU-T T.35 structure
    const countryCode = data[0];
    const providerCode = (data[1] << 8) | data[2];
    
    console.log(`[SEI Registered] Country: ${countryCode}, Provider: ${providerCode}, PTS: ${pts}ms`);
  }
}

// ============================================================================
// Example 3: Combined Usage
// ============================================================================

/**
 * Example: Initialize player with KLV and SEI handling
 */
export function initializePlayerWithMetadata(
  videoElement: HTMLVideoElement,
  streamUrl: string
) {
  // Create handlers
  const klvHandler = new KlvMetadataHandler({
    onPositionUpdate: (pos) => {
      console.log(`Position update: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} @ ${pos.pts}ms`);
      // Update map marker, overlay, etc.
    }
  });
  
  const seiHandler = new SeiMetadataHandler();
  
  // Player configuration
  const config = {
    sources: [createKlvEnabledSource(streamUrl)],
    video: videoElement,
    techOrder: ['ws-raw'] as const,
    buffer: {
      jitterBufferMs: 120,
      catchUp: { mode: 'drop-to-key' as const }
    }
  };
  
  // Note: In actual usage, create FyraPlayer instance and register handlers
  // const player = new FyraPlayer(config);
  // player.on('metadata', (event) => {
  //   klvHandler.handleMetadataEvent(event);
  //   seiHandler.handleMetadataEvent(event);
  // });
  
  return { config, klvHandler, seiHandler };
}

// ============================================================================
// Example 4: Offline File Processing
// ============================================================================

import { Demuxer, DemuxerCallbacks } from '../src/techs/wsRaw/demuxer.js';

/**
 * Process offline TS file for KLV extraction
 */
export async function processOfflineFile(fileBuffer: ArrayBuffer): Promise<Misb0601Data[]> {
  const parser = new MockKlvParser();
  const results: Misb0601Data[] = [];
  
  const callbacks: DemuxerCallbacks = {
    onPrivateData: (pid, data, pts) => {
      try {
        const packets = parser.parse(data);
        for (const packet of packets) {
          if (isMisb0601Key(packet.key)) {
            // Simplified decoding for example
            console.log(`[Offline] KLV packet from PID ${pid} at PTS ${pts}ms`);
            results.push({ timestamp: pts });
          }
        }
      } catch (err) {
        console.warn(`[Offline] Parse error at PTS ${pts}:`, err);
      }
    }
  };
  
  const demuxer = new Demuxer({
    format: 'ts',
    callbacks
  });
  
  // Process file in chunks
  const chunkSize = 188 * 100; // 100 TS packets
  const totalChunks = Math.ceil(fileBuffer.byteLength / chunkSize);
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, fileBuffer.byteLength);
    const chunk = fileBuffer.slice(start, end);
    demuxer.demux(chunk);
    
    // Progress reporting
    if (i % 100 === 0) {
      console.log(`Processing: ${Math.round((i / totalChunks) * 100)}%`);
    }
  }
  
  console.log(`Processed ${results.length} KLV packets`);
  return results;
}

// ============================================================================
// Export for testing
// ============================================================================

export { MockKlvParser, isMisb0601Key, MISB_0601_KEY };
