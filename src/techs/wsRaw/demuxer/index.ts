/**
 * Demuxer Module
 * Unified demuxer supporting FLV, MPEG-TS, and AnnexB formats
 */

import type { DemuxedFrame, DemuxerCallbacks, DemuxerOptions } from './types.js';
import { demuxFlv, createFlvState, type FlvDemuxerState, type FlvDemuxerContext } from './flv-demuxer.js';
import { demuxTs, createTsDemuxerState, type TsDemuxerState, type TsDemuxerContext } from './ts-demuxer.js';
import { demuxAnnexB, type AnnexBDemuxerContext } from './annexb-demuxer.js';
import { demuxPs, createPsState, type PsDemuxerState, type PsDemuxerContext } from './ps-demuxer.js';
import type { SeiProcessorState } from './sei.js';

// Re-export types
export type {
  DemuxedFrame,
  OnPrivateDataCallback,
  OnSEICallback,
  OnPrivateDataDetectedCallback,
  OnSEIDetectedCallback,
  DemuxerCallbacks,
  DemuxerOptions,
  TsState
} from './types.js';

// Re-export utilities for external use
export { splitAnnexBNalus } from './utils.js';
export { getSeiTypeName } from './sei.js';
export { getPrivateDataTypeName } from './private-data.js';

/**
 * Unified Demuxer class
 * Supports FLV, MPEG-TS, and AnnexB formats with metadata extraction
 */
export class Demuxer {
  private format: 'flv' | 'ts' | 'annexb' | 'ps';
  private callbacks?: DemuxerCallbacks;
  private manualPrivateDataPids?: number[];
  
  // Format-specific state
  private flvState: FlvDemuxerState | null = null;
  private tsState: TsDemuxerState | null = null;
  private psState: PsDemuxerState | null = null;
  
  // Detect-only mode
  private privateDataDetectOnly = false;
  private seiDetectOnly = false;
  private extractionEnabled = true;
  private detectedPrivateDataPids = new Set<number>();
  private detectedSeiTypes = new Set<number>();

  constructor(options: DemuxerOptions | 'flv' | 'ts' | 'annexb' | 'ps' = 'flv') {
    if (typeof options === 'string') {
      this.format = options;
    } else {
      this.format = options.format;
      this.callbacks = options.callbacks;
      this.manualPrivateDataPids = options.privateDataPids;
      this.privateDataDetectOnly = options.privateDataDetectOnly ?? false;
      this.seiDetectOnly = options.seiDetectOnly ?? false;
      
      if (this.privateDataDetectOnly || this.seiDetectOnly) {
        this.extractionEnabled = false;
      }
    }
    
    this.initState();
  }

  private initState(): void {
    switch (this.format) {
      case 'flv':
        this.flvState = createFlvState();
        break;
      case 'ts':
        this.tsState = createTsDemuxerState(this.manualPrivateDataPids);
        break;
      case 'ps':
        this.psState = createPsState();
        break;
      // annexb is stateless
    }
  }

  private getSeiState(): SeiProcessorState {
    return {
      detectedSeiTypes: this.detectedSeiTypes,
      seiDetectOnly: this.seiDetectOnly,
      extractionEnabled: this.extractionEnabled
    };
  }

  demux(chunk: ArrayBuffer): DemuxedFrame[] {
    const data = new Uint8Array(chunk);
    
    switch (this.format) {
      case 'flv':
        return this.demuxFlvInternal(data);
      case 'ts':
        return this.demuxTsInternal(data);
      case 'annexb':
        return this.demuxAnnexBInternal(data);
      case 'ps':
        return this.demuxPsInternal(data);
      default:
        return [];
    }
  }

  private demuxFlvInternal(data: Uint8Array): DemuxedFrame[] {
    if (!this.flvState) this.flvState = createFlvState();
    const ctx: FlvDemuxerContext = {
      callbacks: this.callbacks,
      seiState: this.getSeiState()
    };
    return demuxFlv(data, this.flvState, ctx);
  }

  private demuxTsInternal(data: Uint8Array): DemuxedFrame[] {
    if (!this.tsState) this.tsState = createTsDemuxerState(this.manualPrivateDataPids);
    const ctx: TsDemuxerContext = {
      callbacks: this.callbacks,
      seiState: this.getSeiState(),
      manualPrivateDataPids: this.manualPrivateDataPids,
      privateDataDetectOnly: this.privateDataDetectOnly,
      extractionEnabled: this.extractionEnabled,
      detectedPrivateDataPids: this.detectedPrivateDataPids
    };
    return demuxTs(data, this.tsState, ctx);
  }

  private demuxAnnexBInternal(data: Uint8Array): DemuxedFrame[] {
    const ctx: AnnexBDemuxerContext = {
      callbacks: this.callbacks,
      seiState: this.getSeiState()
    };
    return demuxAnnexB(data, ctx);
  }

  private demuxPsInternal(data: Uint8Array): DemuxedFrame[] {
    if (!this.psState) this.psState = createPsState();
    const ctx: PsDemuxerContext = {
      callbacks: this.callbacks,
      seiState: this.getSeiState()
    };
    return demuxPs(data, this.psState, ctx);
  }

  // Public API methods
  isAnnexB(): boolean { return this.format === 'annexb' || this.format === 'ps'; }
  
  enableExtraction(): void {
    this.extractionEnabled = true;
    console.log('[demuxer] ✅ Metadata extraction enabled');
  }

  disableExtraction(): void {
    this.extractionEnabled = false;
    console.log('[demuxer] ⏸️ Metadata extraction disabled');
  }

  isExtractionEnabled(): boolean { return this.extractionEnabled; }
  getDetectedPrivateDataPids(): number[] { return Array.from(this.detectedPrivateDataPids); }
  getDetectedSeiTypes(): number[] { return Array.from(this.detectedSeiTypes); }
  
  getStreamTypeForPid(pid: number): number | undefined {
    return this.tsState?.tsState.privateDataStreamTypes.get(pid);
  }

  hasAudio(): boolean {
    return this.flvState?.audioDetected || this.tsState?.audioDetected || false;
  }

  getAacConfig(): Uint8Array | null {
    return this.flvState?.aacConfig || this.tsState?.aacConfig || null;
  }

  getAudioCodec(): 'aac' | 'opus' | 'unknown' | null {
    return this.flvState?.audioCodec || this.tsState?.audioCodec || null;
  }

  getOpusHead(): Uint8Array | null {
    return this.flvState?.opusHead || null;
  }
}
