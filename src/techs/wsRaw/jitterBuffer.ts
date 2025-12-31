import { DemuxedFrame } from './demuxer.js';

export class JitterBuffer {
  private buffer: DemuxedFrame[] = [];
  private maxMs: number;
  private maxFrames: number;

  constructor(maxMs = 300, maxFrames = 30) {
    this.maxMs = maxMs;
    this.maxFrames = maxFrames;
  }

  push(frames: DemuxedFrame[]): void {
    // Use insertion sort for better performance with mostly-sorted data
    for (const frame of frames) {
      this.insertSorted(frame);
    }
    // Enforce max frames limit
    if (this.buffer.length > this.maxFrames) {
      const excess = this.buffer.length - this.maxFrames;
      this.buffer.splice(0, excess);
    }
  }

  /**
   * Insert frame in sorted order by PTS using binary search
   */
  private insertSorted(frame: DemuxedFrame): void {
    if (this.buffer.length === 0) {
      this.buffer.push(frame);
      return;
    }
    
    // Binary search for insertion point
    let low = 0;
    let high = this.buffer.length;
    
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.buffer[mid].pts < frame.pts) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    
    this.buffer.splice(low, 0, frame);
  }

  drainAll(): DemuxedFrame[] {
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  popUntil(targetPts: number): DemuxedFrame[] {
    // Use binary search to find cutoff point
    let low = 0;
    let high = this.buffer.length;
    
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.buffer[mid].pts <= targetPts) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    
    if (low === 0) return [];
    const out = this.buffer.splice(0, low);
    return out;
  }

  dropLagging(latestPts: number): void {
    const threshold = latestPts - this.maxMs;
    // Binary search for first frame >= threshold
    let low = 0;
    let high = this.buffer.length;
    
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (this.buffer[mid].pts < threshold) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    
    if (low > 0) {
      this.buffer.splice(0, low);
    }
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }

  getBufferDurationMs(): number {
    if (this.buffer.length < 2) return 0;
    return this.buffer[this.buffer.length - 1].pts - this.buffer[0].pts;
  }

  peek(): DemuxedFrame | undefined {
    return this.buffer[0];
  }

  peekLast(): DemuxedFrame | undefined {
    return this.buffer[this.buffer.length - 1];
  }
}
