/**
 * Demuxer Types and Interfaces
 * Shared types for all demuxer modules
 */

export interface DemuxedFrame {
  pts: number;
  data: Uint8Array;
  isKey: boolean;
  track: 'video' | 'audio';
  /** Optional codec identifier for upstream parsers (e.g., GB framing) */
  codec?: 'h264' | 'h265' | 'aac' | 'opus' | 'pcma' | 'pcmu' | string;
  /** Optional audio properties when demuxer is bypassed */
  sampleRate?: number;
  channels?: number;
}

// ============================================================================
// Demuxer Callbacks for Metadata Extraction
// ============================================================================

/**
 * Callback for private data stream extraction (KLV, etc.)
 * @param pid - The PID of the private data stream
 * @param data - Raw bytes of the private data
 * @param pts - Presentation timestamp in milliseconds
 */
export type OnPrivateDataCallback = (pid: number, data: Uint8Array, pts: number) => void;

/**
 * Callback for SEI NAL unit extraction
 * @param data - Raw bytes of the SEI NAL unit (excluding start code)
 * @param pts - Presentation timestamp in milliseconds
 * @param seiType - SEI payload type number
 */
export type OnSEICallback = (data: Uint8Array, pts: number, seiType: number) => void;

/**
 * Callback for private data PID detection (detectOnly mode)
 * @param pid - The detected PID
 * @param streamType - Stream type from PMT (0x06 or 0x15)
 */
export type OnPrivateDataDetectedCallback = (pid: number, streamType: number) => void;

/**
 * Callback for SEI type detection (detectOnly mode)
 * @param seiType - The detected SEI payload type
 */
export type OnSEIDetectedCallback = (seiType: number) => void;

/** Callbacks for metadata extraction from demuxer */
export interface DemuxerCallbacks {
  /** Callback for private data stream extraction (KLV, etc.) */
  onPrivateData?: OnPrivateDataCallback;
  /** Callback for SEI NAL unit extraction */
  onSEI?: OnSEICallback;
  /** Callback for private data PID detection (detectOnly mode) */
  onPrivateDataDetected?: OnPrivateDataDetectedCallback;
  /** Callback for SEI type detection (detectOnly mode) */
  onSEIDetected?: OnSEIDetectedCallback;
}

/** Options for Demuxer construction */
export interface DemuxerOptions {
  /** Container format */
  format: 'flv' | 'ts' | 'annexb' | 'ps';
  /** Metadata extraction callbacks */
  callbacks?: DemuxerCallbacks;
  /** Manual PID specification for private data; auto-detect from PMT if not provided */
  privateDataPids?: number[];
  /** Detect-only mode for private data (detect PIDs but don't extract until enabled) */
  privateDataDetectOnly?: boolean;
  /** Detect-only mode for SEI (detect types but don't extract until enabled) */
  seiDetectOnly?: boolean;
}

/** TS demuxer internal state */
export interface TsState {
  pmtPid: number;
  videoPid: number;
  audioPid: number;
  patParsed: boolean;
  pmtParsed: boolean;
  videoPes: { pts: number; data: Uint8Array[] } | null;
  audioPes: { pts: number; data: Uint8Array[] } | null;
  privateDataPids: Set<number>;
  privateDataPes: Map<number, { pts: number; data: Uint8Array[] }>;
  /** Stream types for detected private data PIDs */
  privateDataStreamTypes: Map<number, number>;
}
