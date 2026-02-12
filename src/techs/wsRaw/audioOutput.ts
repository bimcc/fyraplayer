type WindowWithAudioWorklet = Window & {
  AudioWorkletNode?: typeof AudioWorkletNode;
};

type G711Codec = 'pcma' | 'pcmu';

export class PcmAudioOutput {
  private audioCtx: AudioContext | null = null;
  private pcmWorkletNode: AudioWorkletNode | null = null;
  private pcmWorkletReady = false;
  private readonly enablePcmWorklet: boolean;
  private planePool: Map<number, Float32Array[]> = new Map();
  private g711Pool: Map<number, Float32Array> = new Map();
  private interleavePool: Map<number, Float32Array[]> = new Map();

  constructor(enablePcmWorklet?: boolean) {
    this.enablePcmWorklet =
      enablePcmWorklet ??
      (typeof window !== 'undefined' &&
        typeof (window as WindowWithAudioWorklet).AudioWorkletNode !== 'undefined');
  }

  async ensureContext(sampleRate?: number): Promise<AudioContext> {
    if (!this.audioCtx) {
      this.audioCtx = sampleRate ? new AudioContext({ sampleRate }) : new AudioContext();
    }
    return this.audioCtx;
  }

  playAudioData(audioData: AudioData, onError?: (error: unknown) => void): void {
    if (!this.audioCtx) {
      audioData.close?.();
      return;
    }
    const { numberOfChannels, numberOfFrames, sampleRate } = audioData;
    const planes = this.acquirePlanes(numberOfChannels, numberOfFrames);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = planes[ch];
      if (channelData.length !== numberOfFrames) {
        planes[ch] = new Float32Array(numberOfFrames);
      }
      audioData.copyTo(planes[ch], { planeIndex: ch });
    }

    if (this.enablePcmWorklet) {
      void this.ensurePcmWorklet(sampleRate, numberOfChannels)
        .then(() => {
          if (this.pcmWorkletReady && this.pcmWorkletNode) {
            this.sendPcmPlanesToWorklet(planes, sampleRate);
          } else {
            this.playPcmBuffer(planes, sampleRate);
          }
        })
        .catch((error) => onError?.(error))
        .finally(() => audioData.close?.());
      return;
    }

    this.playPcmBuffer(planes, sampleRate);
    audioData.close?.();
  }

  async playG711Frame(
    codec: G711Codec,
    data: Uint8Array,
    sampleRate: number,
    channels: number,
    onError?: (error: unknown) => void
  ): Promise<void> {
    await this.ensureContext(sampleRate);
    if (this.enablePcmWorklet) {
      await this.ensurePcmWorklet(sampleRate, channels);
    }

    const samples = this.acquireG711Buffer(data.length);
    for (let i = 0; i < data.length; i++) {
      samples[i] = codec === 'pcmu' ? this.decodeMuLawSample(data[i]) : this.decodeALawSample(data[i]);
    }

    try {
      if (this.pcmWorkletReady && this.pcmWorkletNode) {
        this.sendPcmToWorklet(samples, sampleRate, channels);
      } else {
        this.playPcmSamples(samples, sampleRate, channels);
      }
    } catch (error) {
      onError?.(error);
    }
  }

  close(): Promise<void> {
    if (this.pcmWorkletNode) {
      try {
        this.pcmWorkletNode.disconnect();
      } catch {
        /* ignore */
      }
      this.pcmWorkletNode = null;
      this.pcmWorkletReady = false;
    }

    if (this.audioCtx) {
      const ctx = this.audioCtx;
      this.audioCtx = null;
      return ctx.close().catch(() => {});
    }

    return Promise.resolve();
  }

  private playPcmBuffer(planes: Float32Array[], sampleRate: number): void {
    if (!this.audioCtx) return;
    const numberOfChannels = planes.length;
    const numberOfFrames = planes[0]?.length ?? 0;
    const audioBuffer = this.audioCtx.createBuffer(numberOfChannels, numberOfFrames, sampleRate);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      audioBuffer.getChannelData(ch).set(planes[ch]);
    }
    const src = this.audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(this.audioCtx.destination);
    src.start();
  }

  private playPcmSamples(samples: Float32Array, sampleRate: number, channels: number): void {
    if (!this.audioCtx) return;
    const frameCount = Math.floor(samples.length / channels);
    const buffer = this.audioCtx.createBuffer(channels, frameCount, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const channelData = buffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) {
        channelData[i] = samples[i * channels + ch];
      }
    }
    const src = this.audioCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.audioCtx.destination);
    src.start();
  }

  private async ensurePcmWorklet(sampleRate: number, channels: number): Promise<void> {
    await this.ensureContext(sampleRate);
    if (!this.enablePcmWorklet || !this.audioCtx?.audioWorklet || this.pcmWorkletReady) return;
    const code = `
      class PcmSink extends AudioWorkletProcessor {
        constructor() {
          super();
          this.queue = [];
          this.offset = 0;
          this.port.onmessage = (e) => {
            const { channels, data } = e.data;
            const planes = data.map((buf) => new Float32Array(buf));
            this.queue.push({ channels, planes, length: planes[0]?.length || 0 });
          };
        }
        process(inputs, outputs) {
          const output = outputs[0];
          const frames = output[0].length;
          for (let i = 0; i < frames; i++) {
            if (!this.queue.length) {
              for (let ch = 0; ch < output.length; ch++) output[ch][i] = 0;
              continue;
            }
            const cur = this.queue[0];
            for (let ch = 0; ch < output.length; ch++) {
              const plane = cur.planes[Math.min(ch, cur.planes.length - 1)];
              output[ch][i] = plane[this.offset] ?? 0;
            }
            this.offset++;
            if (this.offset >= cur.length) {
              this.queue.shift();
              this.offset = 0;
            }
          }
          return true;
        }
      }
      registerProcessor('pcm-sink', PcmSink);
    `;
    const blob = new Blob([code], { type: 'application/javascript' });
    await this.audioCtx.audioWorklet.addModule(URL.createObjectURL(blob));
    this.pcmWorkletNode = new AudioWorkletNode(this.audioCtx, 'pcm-sink', {
      numberOfOutputs: 1,
      outputChannelCount: [channels]
    });
    this.pcmWorkletNode.connect(this.audioCtx.destination);
    this.pcmWorkletReady = true;
  }

  private sendPcmToWorklet(samples: Float32Array, sampleRate: number, channels: number): void {
    const frameCount = Math.floor(samples.length / channels);
    const planes = this.acquireInterleavePlanes(channels, frameCount);
    for (let ch = 0; ch < channels; ch++) {
      let plane = planes[ch];
      if (plane.length !== frameCount) {
        plane = new Float32Array(frameCount);
        planes[ch] = plane;
      }
      for (let i = 0; i < frameCount; i++) {
        plane[i] = samples[i * channels + ch];
      }
    }
    this.sendPcmPlanesToWorklet(planes, sampleRate);
  }

  private acquirePlanes(channels: number, frames: number): Float32Array[] {
    const key = channels;
    const pooled = this.planePool.get(key);
    if (pooled && pooled.length === channels && pooled.every((p) => p.length === frames)) {
      return pooled;
    }
    const created = Array.from({ length: channels }, () => new Float32Array(frames));
    this.planePool.set(key, created);
    return created;
  }

  private acquireInterleavePlanes(channels: number, frames: number): Float32Array[] {
    const key = channels;
    const pooled = this.interleavePool.get(key);
    if (pooled && pooled.length === channels && pooled.every((p) => p.length === frames)) {
      return pooled;
    }
    const created = Array.from({ length: channels }, () => new Float32Array(frames));
    this.interleavePool.set(key, created);
    return created;
  }

  private acquireG711Buffer(length: number): Float32Array {
    const cached = this.g711Pool.get(length);
    if (cached) return cached;
    const created = new Float32Array(length);
    this.g711Pool.set(length, created);
    return created;
  }

  private sendPcmPlanesToWorklet(planes: Float32Array[], sampleRate: number): void {
    if (!this.pcmWorkletNode || !this.pcmWorkletReady) {
      this.playPcmBuffer(planes, sampleRate);
      return;
    }
    const buffers = planes.map((plane) => plane.buffer);
    this.pcmWorkletNode.port.postMessage({ channels: planes.length, sampleRate, data: buffers }, buffers);
  }

  private decodeMuLawSample(v: number): number {
    const MU = 255.0;
    v = ~v & 0xff;
    const sign = (v & 0x80) ? -1 : 1;
    const exponent = (v >> 4) & 0x07;
    const mantissa = v & 0x0f;
    let sample = (Math.pow(2, exponent + 3) * (mantissa + 0.5)) - 33.5;
    sample = sign * sample / (MU + 1);
    return Math.max(-1, Math.min(1, sample));
  }

  private decodeALawSample(v: number): number {
    v ^= 0x55;
    const sign = (v & 0x80) ? -1 : 1;
    const exponent = (v & 0x70) >> 4;
    const mantissa = v & 0x0f;
    let sample =
      exponent === 0 ? (mantissa << 4) + 8 : ((mantissa + 16) << (exponent + 3));
    sample = sign * sample / 2048;
    return Math.max(-1, Math.min(1, sample));
  }
}
