/**
 * WebCodecs API type declarations
 * These are experimental APIs not yet in standard TypeScript lib
 */

interface AudioDecoderConfig {
  codec: string;
  sampleRate?: number;
  numberOfChannels?: number;
  description?: BufferSource;
}

interface AudioDecoderInit {
  output: (output: AudioData) => void;
  error: (error: DOMException) => void;
}

interface AudioData {
  readonly format: string;
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly duration: number;
  readonly timestamp: number;
  copyTo(destination: BufferSource, options?: AudioDataCopyToOptions): void;
  clone(): AudioData;
  close(): void;
}

interface AudioDataCopyToOptions {
  planeIndex?: number;
  frameOffset?: number;
  frameCount?: number;
}

interface EncodedAudioChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  duration?: number;
  data: BufferSource;
}

declare class AudioDecoder {
  constructor(init: AudioDecoderInit);
  readonly state: 'unconfigured' | 'configured' | 'closed';
  readonly decodeQueueSize: number;
  configure(config: AudioDecoderConfig): void;
  decode(chunk: EncodedAudioChunk): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
  static isConfigSupported(config: AudioDecoderConfig): Promise<{ supported: boolean; config: AudioDecoderConfig }>;
}

declare class EncodedAudioChunk {
  constructor(init: EncodedAudioChunkInit);
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: BufferSource): void;
}
