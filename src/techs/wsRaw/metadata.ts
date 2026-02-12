import type { MetadataConfig, MetadataDetectedEvent, MetadataEvent } from '../../types.js';
import type { DemuxerCallbacks, DemuxerOptions } from './demuxer.js';

type MetadataDetectedHandler = (event: MetadataDetectedEvent) => void;

export function buildDemuxerOptionsWithMetadata(
  transport: 'flv' | 'ts' | 'annexb' | 'ps',
  metadataConfig: MetadataConfig | undefined,
  onMetadata: ((event: MetadataEvent) => void) | undefined,
  onMetadataDetected: MetadataDetectedHandler | undefined,
  metadataBuffer: MetadataEvent[]
): DemuxerOptions {
  const opts: DemuxerOptions = { format: transport };

  if (transport !== 'ts') {
    return opts;
  }

  const callbacks: DemuxerCallbacks = {};
  let hasCallbacks = false;

  const privateDataDetectOnly = metadataConfig?.privateData?.detectOnly ?? false;
  const seiDetectOnly = metadataConfig?.sei?.detectOnly ?? false;

  if (privateDataDetectOnly) {
    opts.privateDataDetectOnly = true;
  }
  if (seiDetectOnly) {
    opts.seiDetectOnly = true;
  }

  if (metadataConfig?.privateData?.enable) {
    hasCallbacks = true;

    if (onMetadata) {
      callbacks.onPrivateData = (pid: number, data: Uint8Array, pts: number) => {
        metadataBuffer.push({
          type: 'private-data',
          raw: data,
          pts,
          pid
        });
      };
    }

    if (onMetadataDetected) {
      callbacks.onPrivateDataDetected = (pid: number, streamType: number) => {
        onMetadataDetected({
          type: 'private-data-detected',
          pids: [pid],
          streamTypes: new Map([[pid, streamType]])
        });
      };
    }

    if (metadataConfig.privateData.pids?.length) {
      opts.privateDataPids = metadataConfig.privateData.pids;
    }
  }

  if (metadataConfig?.sei?.enable) {
    hasCallbacks = true;

    if (onMetadata) {
      callbacks.onSEI = (data: Uint8Array, pts: number, seiType: number) => {
        metadataBuffer.push({
          type: 'sei',
          raw: data,
          pts,
          seiType
        });
      };
    }

    if (onMetadataDetected) {
      callbacks.onSEIDetected = (seiType: number) => {
        onMetadataDetected({
          type: 'sei-detected',
          seiTypes: [seiType]
        });
      };
    }
  }

  if (hasCallbacks) {
    opts.callbacks = callbacks;
  }

  return opts;
}

export function flushMetadataBuffer(
  metadataBuffer: MetadataEvent[],
  onMetadata: ((event: MetadataEvent) => void) | undefined
): MetadataEvent[] {
  if (!metadataBuffer.length || !onMetadata) {
    return [];
  }

  metadataBuffer.sort((a, b) => a.pts - b.pts);
  for (const event of metadataBuffer) {
    try {
      onMetadata(event);
    } catch (err) {
      console.warn('[pipeline] onMetadata callback error:', err);
    }
  }

  return [];
}

