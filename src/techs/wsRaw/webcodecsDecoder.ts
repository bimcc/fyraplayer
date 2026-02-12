import type { DemuxedFrame } from './demuxer.js';

interface VideoDecoderSupportResult {
  supported?: boolean;
}

/**
 * WebCodecs-based H.264 decoder. Only works when browser supports VideoDecoder and H.264.
 */
export class WebCodecsDecoder {
  private decoder: VideoDecoder | null = null;
  private onFrame: (frame: VideoFrame) => void;
  private decodedCount = 0;
  private errorCount = 0;
  private codec: string;
  private configured = false;

  constructor(onFrame: (frame: VideoFrame) => void, codec = 'avc1.42E01E') {
    this.onFrame = onFrame;
    this.codec = codec;
  }

  static isSupported(): boolean {
    return typeof VideoDecoder !== 'undefined' && VideoDecoder.isConfigSupported !== undefined;
  }

  static async isCodecSupported(codec: string): Promise<boolean> {
    if (!WebCodecsDecoder.isSupported()) return false;
    try {
      const supported = (await VideoDecoder.isConfigSupported({ codec })) as VideoDecoderSupportResult;
      return !!supported?.supported;
    } catch {
      return false;
    }
  }

  async init(autoConfigure = true): Promise<void> {
    if (!WebCodecsDecoder.isSupported()) return;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.onFrame(frame);
        frame.close();
        this.decodedCount++;
      },
      error: (e) => {
        this.errorCount++;
        console.error('[webcodecs] decode error', e);
      }
    });
    if (autoConfigure) {
      await this.configure(this.codec);
    }
  }

  async configure(codec: string): Promise<boolean> {
    if (!this.decoder) return false;
    try {
      const supported = (await VideoDecoder.isConfigSupported({ codec })) as VideoDecoderSupportResult;
      if (!supported?.supported) return false;
      this.decoder.reset();
      this.decoder.configure({ codec });
      this.codec = codec;
      this.configured = true;
      this.decodedCount = 0;
      this.errorCount = 0;
      return true;
    } catch (e) {
      this.errorCount++;
      console.warn('[webcodecs] configure failed', e);
      return false;
    }
  }

  decode(frame: DemuxedFrame): void {
    if (!this.decoder || !this.configured) return;
    const chunk = new EncodedVideoChunk({
      type: frame.isKey ? 'key' : 'delta',
      // WebCodecs timestamp is in microseconds
      timestamp: Math.max(0, Math.round(frame.pts * 1000)),
      data: frame.data
    });
    try {
      this.decoder.decode(chunk);
    } catch (e) {
      this.errorCount++;
      console.warn('[webcodecs] decode failed', e);
    }
  }

  /**
   * Reconfigure codec (e.g., switch h264/h265) before init().
   */
  setCodec(codec: string): void {
    this.codec = codec;
    this.configured = false;
  }

  close(): void {
    this.decoder?.close();
    this.decoder = null;
    this.decodedCount = 0;
    this.errorCount = 0;
    this.configured = false;
  }

  hasOutput(): boolean {
    return this.decodedCount > 0;
  }

  hasErrors(): boolean {
    return this.errorCount > 0;
  }

  getErrorCount(): number {
    return this.errorCount;
  }

  getDecodedCount(): number {
    return this.decodedCount;
  }
}
