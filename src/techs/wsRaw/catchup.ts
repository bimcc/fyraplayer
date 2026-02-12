import type { DemuxedFrame } from './demuxer.js';

export type CatchUpMode = 'none' | 'drop-to-key' | 'latest' | 'drop-b' | 'drop-bp';

export type CatchupEventPayload = {
  type: 'catchup';
  mode: CatchUpMode | 'drop-to-key' | 'latest';
  dropped: number;
  kept: number;
};

export interface CatchupContext {
  mode: CatchUpMode;
  latestPts: number;
  maxBufferMs: number;
  maxFrames: number;
}

export function applyCatchUp(
  frames: DemuxedFrame[],
  context: CatchupContext
): { frames: DemuxedFrame[]; dropped: number; event?: CatchupEventPayload } {
  if (!frames.length || context.mode === 'none') {
    return { frames, dropped: 0 };
  }

  const duration = context.latestPts - frames[0].pts;
  const overSize = frames.length > context.maxFrames || duration > context.maxBufferMs;
  if (!overSize) {
    return { frames, dropped: 0 };
  }

  if (context.mode === 'latest') {
    const keep = frames.slice(-1);
    const dropped = frames.length - keep.length;
    return {
      frames: keep,
      dropped,
      event: { type: 'catchup', mode: 'latest', dropped, kept: keep.length }
    };
  }

  if (context.mode === 'drop-b' || context.mode === 'drop-bp') {
    const keep: DemuxedFrame[] = [];
    frames.forEach((frame, idx) => {
      if (frame.isKey || (context.mode === 'drop-bp' && idx % 2 === 0)) {
        keep.push(frame);
      }
    });
    if (!keep.length) keep.push(frames[frames.length - 1]);
    const dropped = frames.length - keep.length;
    return {
      frames: keep,
      dropped,
      event: { type: 'catchup', mode: context.mode, dropped, kept: keep.length }
    };
  }

  let startIdx = -1;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i].isKey) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) startIdx = Math.max(0, frames.length - 6);
  const sliced = frames.slice(startIdx);
  return {
    frames: sliced,
    dropped: startIdx,
    event: { type: 'catchup', mode: 'drop-to-key', dropped: startIdx, kept: sliced.length }
  };
}

