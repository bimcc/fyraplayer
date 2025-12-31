/**
 * Demuxer - Main Entry Point
 * 
 * This file re-exports from the modular demuxer implementation.
 * The actual implementation is split into:
 *   - demuxer/index.ts      - Unified Demuxer class
 *   - demuxer/types.ts      - Type definitions
 *   - demuxer/utils.ts      - Utility functions
 *   - demuxer/flv-demuxer.ts   - FLV container parsing
 *   - demuxer/ts-demuxer.ts    - MPEG-TS container parsing
 *   - demuxer/annexb-demuxer.ts - AnnexB bitstream parsing
 *   - demuxer/sei.ts        - SEI NAL unit processing
 *   - demuxer/private-data.ts - Private data stream handling
 */

export {
  Demuxer,
  splitAnnexBNalus,
  getSeiTypeName,
  getPrivateDataTypeName,
  type DemuxedFrame,
  type OnPrivateDataCallback,
  type OnSEICallback,
  type OnPrivateDataDetectedCallback,
  type OnSEIDetectedCallback,
  type DemuxerCallbacks,
  type DemuxerOptions,
  type TsState
} from './demuxer/index.js';
