import { BufferPolicy, MetadataConfig, MetadataEvent, MetadataDetectedEvent, Source, WebCodecsConfig, WasmDecoderConfig } from '../../types.js';
import { Demuxer, splitAnnexBNalus, type DemuxedFrame } from './demuxer.js';
import { JitterBuffer } from './jitterBuffer.js';
import { DecoderWorker } from './decoderWorker.js';
import { Renderer } from './renderer.js';
import { WebCodecsDecoder } from './webcodecsDecoder.js';
import { decideWebCodecsCodec } from '../../utils/decodeDecision.js';
import { isValidWebSocketUrl } from './url.js';
import { applyCatchUp, CatchUpMode } from './catchup.js';
import { GbCodecHints, concatUint8Arrays, parseGbStreamInfoPayload } from './gbUtils.js';
import { buildDemuxerOptionsWithMetadata, flushMetadataBuffer } from './metadata.js';
import { PcmAudioOutput } from './audioOutput.js';

type NetworkEventPayload = {
  type?: string;
  [key: string]: unknown;
};

type WtConstructor = new (url: string) => {
  ready: Promise<unknown>;
  closed: Promise<unknown>;
  datagrams?: {
    readable?: ReadableStream<Uint8Array>;
  };
  close?: () => void;
};

type AudioDecoderConstructorLike = new (init: {
  output: (audioData: AudioData) => void;
  error: (error: unknown) => void;
}) => AudioDecoder;

type WindowWithExperimentalApis = Window & {
  WebTransport?: WtConstructor;
  AudioDecoder?: AudioDecoderConstructorLike;
};

/**
 * 自研 WS-raw 管线占位：
 * WebSocket -> Demux(FLV/TS/AnnexB) -> JitterBuffer -> WASM Decoder -> WebGL Renderer
 */
export interface WsRawHandlers {
  onReady?: () => void;
  onError?: (err: unknown) => void;
  onNetwork?: (evt: NetworkEventPayload) => void;
  onFallback?: (reason: string) => void;
  /** Metadata event handler for private data and SEI extraction */
  onMetadata?: (event: MetadataEvent) => void;
  /** Metadata detection handler (for detectOnly mode) */
  onMetadataDetected?: (event: MetadataDetectedEvent) => void;
}

export class WsRawPipeline {
  private socket: WebSocket | null = null;
  private demuxer: Demuxer;
  private jitter: JitterBuffer;
  private decoder: DecoderWorker;
  private wasmConfig?: WasmDecoderConfig;
  private webcodecs: WebCodecsDecoder | null = null;
  private webCodecsConfigured = false;
  private renderer: Renderer | null = null;
  private codec: string;
  private url: string;
  private decoderUrl?: string;
  private latestPts = 0;
  private useWebCodecs = false;
  private useWorkerDecoder = false;
  private handlers?: WsRawHandlers;
  private audioDecoder: AudioDecoder | null = null;
  private audioOutput: PcmAudioOutput;
  private audioConfigured = false;
  private bytesIn = 0;
  private videoFramesDecoded = 0;
  private audioFramesDecoded = 0;
  private startedAt = Date.now();
  private droppedFrames = 0;
  private videoReady = false;
  private useAudio = true;
  private useVideo = true;
  private audioClock = 0;
  private videoClock = 0;
  private droppedDecode = 0;
  private configDisableAudio = false;
  private requestFallbackAudio = false;
  private requestFallbackVideo = false;
  private catchUpMaxMs = 800;
  private catchUpMaxFrames = 12;
  private catchUpMode: CatchUpMode = 'drop-to-key';
  private configAudioOptional = true;
  private videoDecodeErrors = 0;
  private lastJitterReport = 0;
  private metadataConfig?: MetadataConfig;
  /** Buffer for metadata events to be sorted by PTS before emission */
  private metadataBuffer: MetadataEvent[] = [];
  /** Optional WebCodecs config */
  private webCodecsConfig?: WebCodecsConfig;
  /** GB28181 framing mode flag */
  private gbMode = false;
  /** Accumulation buffer for GB framing */
  private gbBuffer: Uint8Array = new Uint8Array(0);
  /** Stream info hints for GB framing */
  private gbStreamInfo?: GbCodecHints;
  /** PTS base for GB framing */
  private gbPtsBase = 0;
  /** Optional per-frame hook for VideoFrame (WebCodecs path). Use sync-only. */
  private frameHook?: (frame: VideoFrame) => void;
  /** Use WebTransport instead of WebSocket */
  private useWebTransport = false;
  private wt: { close?: () => void } | null = null;
  private wtReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  constructor(
    source: Extract<Source, { type: 'ws-raw' }>,
    video: HTMLVideoElement,
    buffer?: BufferPolicy,
    handlers?: WsRawHandlers,
    extra?: { webCodecsConfig?: WebCodecsConfig; gbMode?: boolean; gbCodecHints?: GbCodecHints; frameHook?: (frame: VideoFrame) => void }
  ) {
    this.url = source.url;
    this.decoderUrl = source.decoderUrl;
    this.handlers = handlers;
    this.codec = source.codec;
    this.wasmConfig = source.wasm;
    if (this.gbStreamInfo?.videoCodec) {
      this.codec = this.gbStreamInfo.videoCodec;
    }
    this.configDisableAudio = !!source.disableAudio;
    this.configAudioOptional = source.audioOptional !== false;
    this.metadataConfig = source.metadata;
    this.webCodecsConfig = extra?.webCodecsConfig;
    this.frameHook = extra?.frameHook;
    this.gbMode = !!extra?.gbMode;
    this.gbStreamInfo = extra?.gbCodecHints;
    this.gbPtsBase = extra?.gbCodecHints?.ptsBase ?? 0;
    this.useWebTransport = !!source.webTransport;
    this.audioOutput = new PcmAudioOutput();
    
    // Build demuxer options with metadata callbacks (only for TS transport)
    const transport = source.transport ?? 'flv';
    const demuxerOpts = buildDemuxerOptionsWithMetadata(
      transport,
      this.metadataConfig,
      this.handlers?.onMetadata,
      this.handlers?.onMetadataDetected,
      this.metadataBuffer
    );
    this.demuxer = new Demuxer(demuxerOpts);
    
    this.jitter = new JitterBuffer(buffer?.jitterBufferMs ?? 120);
    this.decoder = new DecoderWorker(this.decoderUrl, undefined, this.wasmConfig);
    this.renderer = new Renderer(video);
    if (WebCodecsDecoder.isSupported()) {
      const wcCodec = this.codec === 'h265' ? 'hev1.1.6.L93.B0' : 'avc1.42E01E';
      this.webcodecs = new WebCodecsDecoder((frame) => {
        // Hook is sync-only; frame will be closed after this callback returns.
        this.frameHook?.(frame);
        this.renderer?.renderFrame(frame);
      }, wcCodec);
    }
    this.catchUpMaxMs = buffer?.catchUp?.maxBufferMs ?? buffer?.maxBufferMs ?? 800;
    this.catchUpMaxFrames = buffer?.catchUp?.maxFrames ?? 12;
    this.catchUpMode = buffer?.catchUp?.mode ?? 'drop-to-key';
  }


  /**
   * Enable metadata extraction (for detectOnly mode).
   * Call this after receiving 'metadata-detected' events to start actual extraction.
   */
  enableMetadataExtraction(): void {
    this.demuxer.enableExtraction();
  }

  /**
   * Disable metadata extraction.
   */
  disableMetadataExtraction(): void {
    this.demuxer.disableExtraction();
  }

  /**
   * Get detected private data PIDs.
   */
  getDetectedPrivateDataPids(): number[] {
    return this.demuxer.getDetectedPrivateDataPids();
  }

  /**
   * Get detected SEI types.
   */
  getDetectedSeiTypes(): number[] {
    return this.demuxer.getDetectedSeiTypes();
  }

  async start(): Promise<void> {
    // Validate transport URL
    if (!this.useWebTransport && !isValidWebSocketUrl(this.url)) {
      throw new Error(`Invalid WebSocket URL: ${this.url}. URL must start with ws:// or wss://`);
    }
    const browserApis = window as WindowWithExperimentalApis;
    if (this.useWebTransport && typeof browserApis.WebTransport === 'undefined') {
      throw new Error('WebTransport not supported in this browser');
    }
    
    // 仅当源声明 h264 且 WebCodecs 支持时才使用 WebCodecs
    this.useWebCodecs = false;
    this.webCodecsConfigured = false;
    const allowWebCodecs = this.webCodecsConfig?.enable !== false;
    const allowH265 = this.webCodecsConfig?.allowH265 ?? false;
    const wantsH265 = this.codec === 'h265';
    if (allowWebCodecs && this.webcodecs && (!wantsH265 || allowH265)) {
      this.useWebCodecs = true;
    }
    this.useWorkerDecoder = !this.useWebCodecs && !!this.decoderUrl;
    if (!this.useWebCodecs && !this.useWorkerDecoder) {
      throw new Error('WS-raw experimental pipeline requires WebCodecs support or a WASM decoderUrl');
    }

    if (this.useWorkerDecoder) {
      await this.decoder.init();
    }
    if (this.useWebCodecs) {
      await this.webcodecs?.init(false);
    }

    if (this.useWebTransport) {
      await this.startWebTransport();
    } else {
      this.startWebSocket();
    }
  }

  private startWebSocket(): void {
    this.socket = new WebSocket(this.url);
    this.socket.binaryType = 'arraybuffer';
    this.socket.onopen = () => {
      this.handlers?.onNetwork?.({ type: 'ws-open' });
      this.handlers?.onReady?.();
    };
    this.socket.onclose = () => this.handlers?.onNetwork?.({ type: 'ws-close' });
    this.socket.onerror = (e) => this.handlers?.onError?.(e);
    this.socket.onmessage = (evt) => {
      this.bytesIn += (evt.data as ArrayBuffer).byteLength || 0;
      void this.handleChunk(evt.data as ArrayBuffer);
    };
  }

  private async startWebTransport(): Promise<void> {
    const WebTransportCtor = (window as WindowWithExperimentalApis).WebTransport;
    if (!WebTransportCtor) {
      throw new Error('WebTransport not available');
    }
    const wt = new WebTransportCtor(this.url);
    this.wt = wt;
    await wt.ready;
    this.handlers?.onNetwork?.({ type: 'wt-open' });
    this.handlers?.onReady?.();
    this.wtReader = wt.datagrams?.readable?.getReader() ?? null;
    const reader = this.wtReader;
    if (!reader) {
      throw new Error('WebTransport datagrams not available');
    }
    const loop = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          const buf = value instanceof Uint8Array ? value : new Uint8Array(value);
          this.bytesIn += buf.byteLength;
          await this.handleChunk(buf.buffer as ArrayBuffer);
        }
      }
    };
    loop().catch((err) => this.handlers?.onError?.(err));
    wt.closed
      .then(() => this.handlers?.onNetwork?.({ type: 'wt-close' }))
      .catch((e) => this.handlers?.onError?.(e));
  }

  stop(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    if (this.wtReader) {
      this.wtReader.cancel().catch(() => {});
      this.wtReader = null;
    }
    if (this.wt?.close) {
      this.wt.close();
      this.wt = null;
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.decoder.destroy().catch(() => {});
    this.webcodecs?.close();
    this.webCodecsConfigured = false;
    this.audioDecoder?.close();
    this.audioDecoder = null;
    void this.audioOutput.close();
    this.bytesIn = 0;
    this.videoFramesDecoded = 0;
    this.audioFramesDecoded = 0;
    this.startedAt = Date.now();
    this.droppedFrames = 0;
    this.droppedDecode = 0;
    this.videoReady = false;
    this.audioClock = 0;
    this.videoClock = 0;
    this.requestFallbackAudio = false;
    this.requestFallbackVideo = false;
    this.videoDecodeErrors = 0;
    this.metadataBuffer = [];
    this.gbBuffer = new Uint8Array(0);
    this.gbPtsBase = 0;
  }

  private async handleChunk(data: ArrayBuffer): Promise<void> {
    if (this.gbMode) {
      await this.handleGbFramedChunk(data);
      return;
    }
    const frames = this.demuxer.demux(data);
    if (!frames.length) return;
    const { videoFrames, audioFrames, latestPts } = this.partitionFrames(frames);
    if (!this.configDisableAudio && audioFrames.length) {
      await this.decodeAudioFrames(audioFrames);
      // if audio decoder unavailable, keep video running; audioFrames still consumed
    } else if (this.configDisableAudio && audioFrames.length) {
      this.handlers?.onNetwork?.({ type: 'audio-disabled', reason: 'config' });
    }
    if (!videoFrames.length) return;
    this.jitter.push(videoFrames);
    this.latestPts = latestPts;
    this.jitter.dropLagging(this.latestPts);
    let ready = this.jitter.popUntil(this.latestPts);
    if (ready.length > 0) {
      ready = this.applyCatchUp(ready);
    }
    for (const frame of ready) {
      try {
        await this.decodeFrame(frame);
      } catch (err) {
        this.videoDecodeErrors++;
        this.handlers?.onError?.(err);
        this.handlers?.onNetwork?.({ type: 'video-decode-error', errors: this.videoDecodeErrors });
        if (this.videoDecodeErrors > 3) {
          this.requestFallbackVideo = true;
        }
      }
    }
    // Flush metadata events sorted by PTS after demux cycle
    this.metadataBuffer = flushMetadataBuffer(this.metadataBuffer, this.handlers?.onMetadata);
    
    // 网络/缓冲状态回报，节流上报频率
    const now = Date.now();
    if (now - this.lastJitterReport > 500) {
      this.lastJitterReport = now;
      this.handlers?.onNetwork?.({ type: 'jitter', size: this.jitter.size(), latestPts: this.latestPts });
    }
    if (this.requestFallbackAudio || this.requestFallbackVideo) {
      const reason = this.requestFallbackAudio ? 'audio decode failed' : 'video decode failed';
      this.handlers?.onFallback?.(reason);
      this.requestFallbackAudio = false;
      this.requestFallbackVideo = false;
    }
  }

  /**
   * GB28181 自定义帧头解析: [type][flags][tsMs][len] + payload
   * type=0 为 stream-info (JSON/TLV)，type=1 视频，type=2 音频，type=3 预留控制
   */
  private async handleGbFramedChunk(data: ArrayBuffer): Promise<void> {
    const incoming = new Uint8Array(data);
    this.gbBuffer = concatUint8Arrays(this.gbBuffer, incoming);
    const view = new DataView(this.gbBuffer.buffer, this.gbBuffer.byteOffset, this.gbBuffer.byteLength);
    let offset = 0;
    const frames: DemuxedFrame[] = [];

    while (offset + 5 <= this.gbBuffer.length) {
      const type = this.gbBuffer[offset];
      // stream-info: [0][len u32]
      if (type === 0) {
        if (offset + 5 > this.gbBuffer.length) break;
        const len = view.getUint32(offset + 1);
        if (offset + 5 + len > this.gbBuffer.length) break;
        const payload = this.gbBuffer.slice(offset + 5, offset + 5 + len);
        this.applyGbStreamInfo(payload);
        offset += 5 + len;
        continue;
      }
      // frame: [type][flags][tsMs u32][len u32]
      if (offset + 10 > this.gbBuffer.length) break;
      const flags = this.gbBuffer[offset + 1];
      const ts = view.getUint32(offset + 2);
      const size = view.getUint32(offset + 6);
      if (offset + 10 + size > this.gbBuffer.length) break;
      const payload = this.gbBuffer.slice(offset + 10, offset + 10 + size);
      offset += 10 + size;

      if (type === 1) {
        frames.push({
          pts: this.gbPtsBase + ts,
          data: payload,
          isKey: (flags & 0x1) === 0x1,
          track: 'video',
          codec: this.gbStreamInfo?.videoCodec ?? this.codec
        });
      } else if (type === 2) {
        frames.push({
          pts: this.gbPtsBase + ts,
          data: payload,
          isKey: true,
          track: 'audio',
          codec: this.gbStreamInfo?.audioCodec,
          sampleRate: this.gbStreamInfo?.sampleRate,
          channels: this.gbStreamInfo?.channels
        });
      } else if (type === 3) {
        this.handlers?.onNetwork?.({ type: 'gb-control', payload: payload.slice() });
      }
    }

    // trim consumed bytes
    if (offset > 0) {
      this.gbBuffer = this.gbBuffer.slice(offset);
    }
    if (!frames.length) return;

    const { videoFrames, audioFrames, latestPts } = this.partitionFrames(frames);
    if (!this.configDisableAudio && audioFrames.length) {
      await this.decodeAudioFrames(audioFrames);
    } else if (this.configDisableAudio && audioFrames.length) {
      this.handlers?.onNetwork?.({ type: 'audio-disabled', reason: 'config' });
    }
    if (!videoFrames.length) return;
    this.jitter.push(videoFrames);
    this.latestPts = latestPts;
    this.jitter.dropLagging(this.latestPts);
    let ready = this.jitter.popUntil(this.latestPts);
    if (ready.length > 0) {
      ready = this.applyCatchUp(ready);
    }
    for (const frame of ready) {
      try {
        await this.decodeFrame(frame);
      } catch (err) {
        this.videoDecodeErrors++;
        this.handlers?.onError?.(err);
        this.handlers?.onNetwork?.({ type: 'video-decode-error', errors: this.videoDecodeErrors });
        if (this.videoDecodeErrors > 3) {
          this.requestFallbackVideo = true;
        }
      }
    }
  }

  private applyGbStreamInfo(payload: Uint8Array): void {
    const result = parseGbStreamInfoPayload(payload, this.gbStreamInfo);
    if (!result) return;
    this.gbStreamInfo = result.streamInfo;
    if (typeof result.ptsBase === 'number') {
      this.gbPtsBase = result.ptsBase;
    }
    if (result.resetWebCodecsConfig) {
      this.webCodecsConfigured = false;
    }
    if (result.codec) {
      this.codec = result.codec;
      if (this.webcodecs) {
        const wcCodec = result.codec === 'h265' ? 'hev1.1.6.L93.B0' : 'avc1.42E01E';
        this.webcodecs.setCodec(wcCodec);
      }
    }
  }

  private partitionFrames(frames: DemuxedFrame[]): {
    videoFrames: DemuxedFrame[];
    audioFrames: DemuxedFrame[];
    latestPts: number;
  } {
    const videoFrames: DemuxedFrame[] = [];
    const audioFrames: DemuxedFrame[] = [];
    let latestPts = this.latestPts;
    for (const frame of frames) {
      if (frame.track === 'video') {
        videoFrames.push(frame);
      } else if (frame.track === 'audio') {
        audioFrames.push(frame);
      }
      if (frame.pts > latestPts) {
        latestPts = frame.pts;
      }
    }
    return { videoFrames, audioFrames, latestPts };
  }

  private async ensureWebCodecsConfigured(frame: DemuxedFrame): Promise<boolean> {
    if (!this.webcodecs) return false;
    if (this.webCodecsConfigured) return true;

    const hint = this.gbStreamInfo?.videoCodec ?? (this.codec === 'h265' ? 'h265' : 'h264');
    const decision = await decideWebCodecsCodec({
      annexb: frame.data,
      sps: this.gbStreamInfo?.sps,
      vps: this.gbStreamInfo?.vps,
      codecHint: hint,
      allowH265: this.webCodecsConfig?.allowH265
    });

    if (!decision.supported || !decision.codec) {
      this.handlers?.onNetwork?.({
        type: 'webcodecs-config-unsupported',
        codec: decision.derived ?? decision.candidates[0],
        reason: decision.reason
      });
      return false;
    }

    const ok = await this.webcodecs.configure(decision.codec);
    if (!ok) {
      this.handlers?.onNetwork?.({ type: 'webcodecs-config-unsupported', codec: decision.codec, reason: 'configure-failed' });
      return false;
    }

    this.webCodecsConfigured = true;
    this.handlers?.onNetwork?.({ type: 'webcodecs-config', codec: decision.codec });
    return true;
  }

  private async decodeFrame(frame: DemuxedFrame): Promise<void> {
    if (!this.useVideo) return;
    if (this.useWebCodecs && this.webcodecs) {
      const configured = await this.ensureWebCodecsConfigured(frame);
      if (configured) {
        this.webcodecs.decode(frame);
        this.videoFramesDecoded++;
        this.videoDecodeErrors = 0;
        if (!this.videoReady) this.videoReady = true;
        this.videoClock = frame.pts;
        return;
      }
      // WebCodecs unsupported for this codec string, try WASM decoder if available
      this.useWebCodecs = false;
      if (this.decoderUrl) {
        this.useWorkerDecoder = true;
        await this.decoder.init();
        this.handlers?.onNetwork?.({ type: 'webcodecs-fallback', reason: 'unsupported-codec' });
      } else {
        this.requestFallbackVideo = true;
        return;
      }
    }
    if (this.useWorkerDecoder) {
      await this.decoder.init();
      const nalus = splitAnnexBNalus(frame.data);
      const decoded = await this.decoder.decode(nalus);
      if (decoded.length) {
        this.renderer?.render(decoded);
        this.videoFramesDecoded += decoded.length || 0;
        this.videoDecodeErrors = 0;
        if (!this.videoReady) this.videoReady = true;
        this.videoClock = frame.pts;
      } else {
        this.droppedFrames++;
        this.droppedDecode++;
        if (this.droppedDecode > 8) {
          this.requestFallbackVideo = true;
        }
      }
    }
  }


  private async ensureAudioDecoder(): Promise<void> {
    if (this.audioConfigured) return;
    if (this.configDisableAudio) throw new Error('audio disabled by config');
    const asc = this.gbMode ? this.gbStreamInfo?.asc : this.demuxer.getAacConfig();
    const codec = (this.gbMode ? this.gbStreamInfo?.audioCodec : this.demuxer.getAudioCodec()) || 'unknown';
    if ((codec === 'pcma' || codec === 'pcmu')) {
      // G.711 不使用 AudioDecoder
      this.audioConfigured = true;
      return;
    }
    if (codec === 'aac' && !asc) throw new Error('AAC config missing');
    const audioDecoderCtor = (window as WindowWithExperimentalApis).AudioDecoder;
    if (!audioDecoderCtor) {
      throw new Error('AudioDecoder not supported');
    }
    const channels = this.gbMode ? this.gbStreamInfo?.channels ?? 2 : 2;
    const sampleRate = this.gbMode ? this.gbStreamInfo?.sampleRate ?? 48000 : 48000;
    await this.audioOutput.ensureContext(sampleRate);
    this.audioDecoder = new audioDecoderCtor({
      output: (audioData: AudioData) => this.audioOutput.playAudioData(audioData, (error) => this.handlers?.onError?.(error)),
      error: (e: unknown) => this.handlers?.onError?.(e)
    });
    if (!this.audioDecoder) throw new Error('AudioDecoder init failed');
    if (codec === 'aac' && asc) {
      this.audioDecoder.configure({
        codec: 'mp4a.40.2',
        numberOfChannels: channels,
        sampleRate,
        description: asc.buffer ?? asc
      });
    } else if (codec === 'opus') {
      this.audioDecoder.configure({
        codec: 'opus',
        numberOfChannels: channels,
        sampleRate
      });
    } else {
      throw new Error('Unsupported audio codec for WebCodecs');
    }
    this.audioConfigured = true;
  }

  private async decodeAudioFrames(frames: DemuxedFrame[]): Promise<void> {
    if (!this.useAudio) return;
    const codec = (this.gbMode ? this.gbStreamInfo?.audioCodec : this.demuxer.getAudioCodec()) || 'unknown';
    // G.711 直接软解播放
    if (codec === 'pcma' || codec === 'pcmu') {
      const sampleRate = this.gbStreamInfo?.sampleRate ?? 8000;
      const channels = this.gbStreamInfo?.channels ?? 1;
      for (const f of frames) {
        await this.audioOutput.playG711Frame(codec, f.data, sampleRate, channels, (error) => this.handlers?.onError?.(error));
        this.audioFramesDecoded++;
        this.audioClock = f.pts;
      }
      return;
    }
    try {
      await this.ensureAudioDecoder();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'audio decode failed';
      this.handlers?.onNetwork?.({ type: 'audio-fallback', reason });
      if (!this.configAudioOptional) {
        this.handlers?.onFallback?.(reason);
        this.requestFallbackAudio = true;
      }
      this.useAudio = false;
      if (this.configAudioOptional) {
        this.handlers?.onNetwork?.({ type: 'audio-disabled', reason: 'optional-audio-unavailable' });
      }
      return;
    }
    if (!this.audioDecoder) return;
    for (const f of frames) {
      this.audioClock = f.pts;
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: Math.max(0, Math.round(f.pts * 1000)), // microseconds
        data: f.data
      });
      try {
        this.audioDecoder.decode(chunk);
        this.audioFramesDecoded++;
      } catch (e) {
        this.handlers?.onError?.(e);
      }
    }
  }

  getStats(): { ts: number; bitrateKbps?: number; fps?: number; audioFps?: number; avSyncMs?: number; dropped?: number } {
    const now = Date.now();
    const elapsed = Math.max(1, now - this.startedAt);
    const bitrateKbps = this.bytesIn > 0 ? Math.round((this.bytesIn * 8) / (elapsed / 1000) / 1000) : undefined;
    const fps = this.videoFramesDecoded > 0 ? Math.round(this.videoFramesDecoded / (elapsed / 1000)) : undefined;
    const audioFps = this.audioFramesDecoded > 0 ? Math.round(this.audioFramesDecoded / (elapsed / 1000)) : undefined;
    const avSyncMs = this.audioClock && this.videoClock ? this.videoClock - this.audioClock : undefined;
    return { ts: now, bitrateKbps, fps, audioFps, avSyncMs, dropped: this.droppedFrames + this.droppedDecode };
  }

  /**
   * Update frame hook at runtime (WebCodecs path).
   * Hook is sync-only; frame is closed after callback returns.
   */
  setFrameHook(hook?: (frame: VideoFrame) => void): void {
    this.frameHook = hook;
  }

  /**
   * catch-up: 当缓冲过长时丢弃旧帧，优先从最近关键帧开始。
   */
  private applyCatchUp(frames: DemuxedFrame[]): DemuxedFrame[] {
    const result = applyCatchUp(frames, {
      mode: this.catchUpMode,
      latestPts: this.latestPts,
      maxBufferMs: this.catchUpMaxMs,
      maxFrames: this.catchUpMaxFrames
    });
    this.droppedFrames += result.dropped;
    if (result.event) {
      this.handlers?.onNetwork?.(result.event);
    }
    return result.frames;
  }
}
