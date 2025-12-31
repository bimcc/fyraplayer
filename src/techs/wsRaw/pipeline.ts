import { BufferPolicy, MetadataConfig, MetadataEvent, MetadataDetectedEvent, Source, WebCodecsConfig } from '../../types.js';
import { Demuxer, DemuxerCallbacks, DemuxerOptions, splitAnnexBNalus, type DemuxedFrame } from './demuxer.js';
import { JitterBuffer } from './jitterBuffer.js';
import { DecoderWorker } from './decoderWorker.js';
import { Renderer } from './renderer.js';
import { WebCodecsDecoder } from './webcodecsDecoder.js';

interface GbCodecHints {
  videoCodec?: 'h264' | 'h265';
  audioCodec?: 'aac' | 'pcma' | 'pcmu' | 'opus';
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  sps?: Uint8Array;
  pps?: Uint8Array;
  vps?: Uint8Array;
  asc?: Uint8Array;
  opusHead?: Uint8Array;
  ptsBase?: number;
}

/**
 * 自研 WS-raw 管线占位：
 * WebSocket -> Demux(FLV/TS/AnnexB) -> JitterBuffer -> WASM Decoder -> WebGL Renderer
 */
export interface WsRawHandlers {
  onReady?: () => void;
  onError?: (err: any) => void;
  onNetwork?: (evt: any) => void;
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
  private webcodecs: WebCodecsDecoder | null = null;
  private renderer: Renderer | null = null;
  private codec: string;
  private url: string;
  private buffer?: BufferPolicy;
  private decoderUrl?: string;
  private latestPts = 0;
  private useWebCodecs = false;
  private useWorkerDecoder = false;
  private handlers?: WsRawHandlers;
  private audioCtx: AudioContext | null = null;
  private audioDecoder: AudioDecoder | null = null;
  private audioConfigured = false;
  private bytesIn = 0;
  private videoFramesDecoded = 0;
  private audioFramesDecoded = 0;
  private startedAt = Date.now();
  private droppedFrames = 0;
  private videoReady = false;
  private audioReady = false;
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
  private catchUpMode: 'none' | 'drop-to-key' | 'latest' | 'drop-b' | 'drop-bp' = 'drop-to-key';
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
  private wt: any = null;
  private wtReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** Optional AudioWorklet sink for PCM playback */
  private pcmWorkletNode: AudioWorkletNode | null = null;
  private pcmWorkletReady = false;
  private enablePcmWorklet = false;

  constructor(
    source: Extract<Source, { type: 'ws-raw' }>,
    video: HTMLVideoElement,
    buffer?: BufferPolicy,
    handlers?: WsRawHandlers,
    extra?: { webCodecsConfig?: WebCodecsConfig; gbMode?: boolean; gbCodecHints?: GbCodecHints; frameHook?: (frame: VideoFrame) => void }
  ) {
    this.url = source.url;
    this.buffer = buffer;
    this.decoderUrl = source.decoderUrl;
    this.handlers = handlers;
    this.codec = source.codec;
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
    this.useWebTransport = !!(source as any).webTransport;
    this.enablePcmWorklet = typeof (window as any).AudioWorkletNode !== 'undefined';
    
    // Build demuxer options with metadata callbacks (only for TS transport)
    const transport = source.transport ?? 'flv';
    const demuxerOpts = this.buildDemuxerOptions(transport);
    this.demuxer = new Demuxer(demuxerOpts);
    
    this.jitter = new JitterBuffer(buffer?.jitterBufferMs ?? 120);
    this.decoder = new DecoderWorker(this.decoderUrl);
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
   * Build DemuxerOptions with metadata callbacks based on source configuration.
   * Metadata extraction is only enabled for TS transport.
   * Metadata events are buffered and sorted by PTS before emission.
   */
  private buildDemuxerOptions(transport: 'flv' | 'ts' | 'annexb' | 'ps'): DemuxerOptions {
    const opts: DemuxerOptions = { format: transport };
    
    // Metadata extraction only supported for TS transport
    if (transport !== 'ts') {
      return opts;
    }
    
    const callbacks: DemuxerCallbacks = {};
    let hasCallbacks = false;
    
    // Check for detectOnly mode
    const privateDataDetectOnly = this.metadataConfig?.privateData?.detectOnly ?? false;
    const seiDetectOnly = this.metadataConfig?.sei?.detectOnly ?? false;
    
    // Set detectOnly options
    if (privateDataDetectOnly) {
      opts.privateDataDetectOnly = true;
    }
    if (seiDetectOnly) {
      opts.seiDetectOnly = true;
    }
    
    // Private data extraction - buffer events for PTS ordering
    if (this.metadataConfig?.privateData?.enable) {
      hasCallbacks = true;
      
      // Full extraction callback
      if (this.handlers?.onMetadata) {
        callbacks.onPrivateData = (pid: number, data: Uint8Array, pts: number) => {
          this.metadataBuffer.push({
            type: 'private-data',
            raw: data,
            pts,
            pid
          });
        };
      }
      
      // Detection callback (for detectOnly mode)
      if (this.handlers?.onMetadataDetected) {
        callbacks.onPrivateDataDetected = (pid: number, streamType: number) => {
          this.handlers?.onMetadataDetected?.({
            type: 'private-data-detected',
            pids: [pid],
            streamTypes: new Map([[pid, streamType]])
          });
        };
      }
      
      // Set manual PIDs if specified
      if (this.metadataConfig.privateData.pids?.length) {
        opts.privateDataPids = this.metadataConfig.privateData.pids;
      }
    }
    
    // SEI extraction - buffer events for PTS ordering
    if (this.metadataConfig?.sei?.enable) {
      hasCallbacks = true;
      
      // Full extraction callback
      if (this.handlers?.onMetadata) {
        callbacks.onSEI = (data: Uint8Array, pts: number, seiType: number) => {
          this.metadataBuffer.push({
            type: 'sei',
            raw: data,
            pts,
            seiType
          });
        };
      }
      
      // Detection callback (for detectOnly mode)
      if (this.handlers?.onMetadataDetected) {
        callbacks.onSEIDetected = (seiType: number) => {
          this.handlers?.onMetadataDetected?.({
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

  /**
   * Flush buffered metadata events sorted by PTS.
   * Called after each demux cycle to emit events in presentation order.
   */
  private flushMetadataBuffer(): void {
    if (this.metadataBuffer.length === 0) return;
    
    // Sort by PTS (ascending order for presentation time)
    this.metadataBuffer.sort((a, b) => a.pts - b.pts);
    
    // Emit all buffered events
    for (const event of this.metadataBuffer) {
      try {
        this.handlers?.onMetadata?.(event);
      } catch (err) {
        // Silently ignore callback errors to continue processing
        console.warn('[pipeline] onMetadata callback error:', err);
      }
    }
    
    // Clear buffer
    this.metadataBuffer = [];
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
    if (!this.useWebTransport && !this.isValidWebSocketUrl(this.url)) {
      throw new Error(`Invalid WebSocket URL: ${this.url}. URL must start with ws:// or wss://`);
    }
    if (this.useWebTransport && typeof (window as any).WebTransport === 'undefined') {
      throw new Error('WebTransport not supported in this browser');
    }
    
    // 仅当源声明 h264 且 WebCodecs 支持时才使用 WebCodecs
    this.useWebCodecs = false;
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
      await this.webcodecs?.init();
    }

    if (this.useWebTransport) {
      await this.startWebTransport();
    } else {
      this.startWebSocket();
    }
  }

  /**
   * Validate WebSocket URL format.
   * Only ws:// and wss:// protocols are allowed.
   */
  private isValidWebSocketUrl(url: string): boolean {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
    } catch {
      // URL parsing failed - check simple prefix
      return url.startsWith('ws://') || url.startsWith('wss://');
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
    const WebTransportCtor = (window as any).WebTransport;
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
      .catch((e: any) => this.handlers?.onError?.(e));
  }

  stop(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.decoder.destroy().catch(() => {});
    this.webcodecs?.close();
    this.audioDecoder?.close();
    this.audioDecoder = null;
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {});
      this.audioCtx = null;
    }
    this.bytesIn = 0;
    this.videoFramesDecoded = 0;
    this.audioFramesDecoded = 0;
    this.startedAt = Date.now();
    this.droppedFrames = 0;
    this.droppedDecode = 0;
    this.videoReady = false;
    this.audioReady = false;
    this.audioClock = 0;
    this.videoClock = 0;
    this.requestFallbackAudio = false;
    this.requestFallbackVideo = false;
    this.videoDecodeErrors = 0;
    this.metadataBuffer = [];
    this.gbBuffer = new Uint8Array(0);
    this.gbPtsBase = 0;
    if (this.pcmWorkletNode) {
      try {
        this.pcmWorkletNode.disconnect();
      } catch {
        /* ignore */
      }
      this.pcmWorkletNode = null;
      this.pcmWorkletReady = false;
    }
  }

  private async handleChunk(data: ArrayBuffer): Promise<void> {
    if (this.gbMode) {
      await this.handleGbFramedChunk(data);
      return;
    }
    const frames = this.demuxer.demux(data);
    if (!frames.length) return;
    const videoFrames = frames.filter((f) => f.track === 'video');
    const audioFrames = frames.filter((f) => f.track === 'audio');
    if (!this.configDisableAudio && audioFrames.length) {
      await this.decodeAudioFrames(audioFrames);
      // if audio decoder unavailable, keep video running; audioFrames still consumed
    } else if (this.configDisableAudio && audioFrames.length) {
      this.handlers?.onNetwork?.({ type: 'audio-disabled', reason: 'config' });
    }
    if (!videoFrames.length) return;
    this.jitter.push(videoFrames);
    const lastIncomingPts = frames.reduce((max, f) => (f.pts > max ? f.pts : max), this.latestPts);
    this.latestPts = Math.max(this.latestPts, lastIncomingPts);
    this.jitter.dropLagging(this.latestPts);
    let ready = this.jitter.popUntil(this.latestPts);
    if (ready.length > 0) {
      ready = this.maybeCatchUp(ready);
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
    this.flushMetadataBuffer();
    
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
    this.gbBuffer = this.concatBuffers(this.gbBuffer, incoming);
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

    const videoFrames = frames.filter((f) => f.track === 'video');
    const audioFrames = frames.filter((f) => f.track === 'audio');
    if (!this.configDisableAudio && audioFrames.length) {
      await this.decodeAudioFrames(audioFrames);
    } else if (this.configDisableAudio && audioFrames.length) {
      this.handlers?.onNetwork?.({ type: 'audio-disabled', reason: 'config' });
    }
    if (!videoFrames.length) return;
    this.jitter.push(videoFrames);
    const lastIncomingPts = frames.reduce((max, f) => (f.pts > max ? f.pts : max), this.latestPts);
    this.latestPts = Math.max(this.latestPts, lastIncomingPts);
    this.jitter.dropLagging(this.latestPts);
    let ready = this.jitter.popUntil(this.latestPts);
    if (ready.length > 0) {
      ready = this.maybeCatchUp(ready);
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

  private concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
    if (a.length === 0) return b;
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  private applyGbStreamInfo(payload: Uint8Array): void {
    if (!payload?.length) return;
    let jsonText: string | null = null;
    try {
      jsonText = new TextDecoder().decode(payload);
    } catch {
      /* ignore */
    }
    if (!jsonText) return;
    try {
      const info = JSON.parse(jsonText);
      const normalized: GbCodecHints = {
        videoCodec: info.codecVideo ?? info.videoCodec,
        audioCodec: info.codecAudio ?? info.audioCodec,
        width: info.width,
        height: info.height,
        sampleRate: info.sampleRate,
        channels: info.channels,
        ptsBase: info.ptsBase ?? 0,
        sps: info.sps ? this.decodeMaybeBase64(info.sps) : undefined,
        pps: info.pps ? this.decodeMaybeBase64(info.pps) : undefined,
        vps: info.vps ? this.decodeMaybeBase64(info.vps) : undefined,
        asc: info.asc ? this.decodeMaybeBase64(info.asc) : undefined,
        opusHead: info.opusHead ? this.decodeMaybeBase64(info.opusHead) : undefined
      };
      this.gbStreamInfo = { ...this.gbStreamInfo, ...normalized };
      if (typeof normalized.ptsBase === 'number') {
        this.gbPtsBase = normalized.ptsBase;
      }
      if (normalized.videoCodec) {
        this.codec = normalized.videoCodec;
        if (this.webcodecs) {
          const wcCodec = normalized.videoCodec === 'h265' ? 'hev1.1.6.L93.B0' : 'avc1.42E01E';
          this.webcodecs.setCodec(wcCodec);
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  private decodeMaybeBase64(input: string | Uint8Array): Uint8Array {
    if (input instanceof Uint8Array) return input;
    try {
      const bin = atob(input);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      return new TextEncoder().encode(input);
    }
  }

  private async decodeFrame(frame: DemuxedFrame): Promise<void> {
    if (!this.useVideo) return;
    if (this.useWebCodecs && this.webcodecs) {
      this.webcodecs.decode(frame);
      this.videoFramesDecoded++;
       // 重置累计错误计数
      this.videoDecodeErrors = 0;
      if (!this.videoReady) this.videoReady = true;
      this.videoClock = frame.pts;
      return;
    }
    if (this.useWorkerDecoder) {
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
    const opusHead = this.gbMode ? this.gbStreamInfo?.opusHead : this.demuxer.getOpusHead();
    const codec = (this.gbMode ? this.gbStreamInfo?.audioCodec : this.demuxer.getAudioCodec()) || 'unknown';
    if ((codec === 'pcma' || codec === 'pcmu')) {
      // G.711 不使用 AudioDecoder
      this.audioConfigured = true;
      return;
    }
    if (codec === 'aac' && !asc) throw new Error('AAC config missing');
    if (typeof (window as any).AudioDecoder === 'undefined') {
      throw new Error('AudioDecoder not supported');
    }
    const channels = this.gbMode ? this.gbStreamInfo?.channels ?? 2 : 2;
    const sampleRate = this.gbMode ? this.gbStreamInfo?.sampleRate ?? 48000 : 48000;
    this.audioCtx = new AudioContext();
    this.audioDecoder = new (window as any).AudioDecoder({
      output: (audioData: any) => this.playAudioData(audioData),
      error: (e: any) => this.handlers?.onError?.(e)
    });
    if (!this.audioDecoder) throw new Error('AudioDecoder init failed');
    if (codec === 'aac' && asc) {
      await this.audioDecoder.configure({
        codec: 'mp4a.40.2',
        numberOfChannels: channels,
        sampleRate,
        description: asc.buffer ?? asc
      });
    } else if (codec === 'opus') {
      await this.audioDecoder.configure({
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
        await this.decodeG711Frame(codec, f.data, sampleRate, channels);
        this.audioFramesDecoded++;
        this.audioClock = f.pts;
      }
      return;
    }
    try {
      await this.ensureAudioDecoder();
    } catch (err) {
      const reason = (err as any)?.message || 'audio decode failed';
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

  private playAudioData(audioData: any): void {
    if (!this.audioCtx) return;
    const { numberOfChannels, numberOfFrames, sampleRate } = audioData;
    const planes: Float32Array[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = new Float32Array(numberOfFrames);
      audioData.copyTo(channelData, { planeIndex: ch });
      planes.push(channelData);
    }
    if (this.enablePcmWorklet) {
      void this.ensurePcmWorklet(sampleRate, numberOfChannels).then(() => {
        if (this.pcmWorkletReady && this.pcmWorkletNode) {
          this.sendPcmPlanesToWorklet(planes, sampleRate);
        } else {
          this.playPcmBuffer(planes, sampleRate);
        }
        audioData.close?.();
      });
      return;
    }
    this.playPcmBuffer(planes, sampleRate);
    audioData.close?.();
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

  private async decodeG711Frame(codec: 'pcma' | 'pcmu', data: Uint8Array, sampleRate: number, channels: number): Promise<void> {
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ sampleRate });
    }
    if (this.enablePcmWorklet) {
      await this.ensurePcmWorklet(sampleRate, channels);
    }
    const samples = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) {
      samples[i] = codec === 'pcmu' ? this.decodeMuLawSample(data[i]) : this.decodeALawSample(data[i]);
    }
    if (this.pcmWorkletReady && this.pcmWorkletNode) {
      this.sendPcmToWorklet(samples, sampleRate, channels);
    } else {
      this.playPcmSamples(samples, sampleRate, channels);
    }
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
    if (!this.audioCtx) {
      this.audioCtx = new AudioContext({ sampleRate });
    }
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
    this.pcmWorkletNode = new AudioWorkletNode(this.audioCtx, 'pcm-sink', { numberOfOutputs: 1, outputChannelCount: [channels] });
    this.pcmWorkletNode.connect(this.audioCtx.destination);
    this.pcmWorkletReady = true;
  }

  private sendPcmToWorklet(samples: Float32Array, sampleRate: number, channels: number): void {
    const frameCount = Math.floor(samples.length / channels);
    const planes: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) {
      const plane = new Float32Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
        plane[i] = samples[i * channels + ch];
      }
      planes.push(plane);
    }
    this.sendPcmPlanesToWorklet(planes, sampleRate);
  }

  private sendPcmPlanesToWorklet(planes: Float32Array[], sampleRate: number): void {
    if (!this.pcmWorkletNode || !this.pcmWorkletReady) {
      this.playPcmBuffer(planes, sampleRate);
      return;
    }
    const buffers = planes.map((p) => p.buffer);
    this.pcmWorkletNode.port.postMessage({ channels: planes.length, sampleRate, data: buffers }, buffers);
  }

  private decodeMuLawSample(v: number): number {
    const MU = 255.0;
    v = ~v & 0xff;
    const sign = (v & 0x80) ? -1 : 1;
    let exponent = (v >> 4) & 0x07;
    let mantissa = v & 0x0f;
    let sample = (Math.pow(2, exponent + 3) * (mantissa + 0.5)) - 33.5;
    sample = sign * sample / (MU + 1);
    return Math.max(-1, Math.min(1, sample));
  }

  private decodeALawSample(v: number): number {
    v ^= 0x55;
    const sign = (v & 0x80) ? -1 : 1;
    let exponent = (v & 0x70) >> 4;
    let mantissa = v & 0x0f;
    let sample =
      exponent === 0 ? (mantissa << 4) + 8 : ((mantissa + 16) << (exponent + 3));
    sample = sign * sample / 2048;
    return Math.max(-1, Math.min(1, sample));
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
  private maybeCatchUp(frames: DemuxedFrame[]): DemuxedFrame[] {
    if (this.catchUpMode === 'none') return frames;
    const duration = this.latestPts - frames[0].pts;
    const overSize = frames.length > this.catchUpMaxFrames || duration > this.catchUpMaxMs;
    if (!overSize) return frames;
    if (this.catchUpMode === 'latest') {
      const keep = frames.slice(-1);
      this.droppedFrames += frames.length - keep.length;
      this.handlers?.onNetwork?.({ type: 'catchup', mode: 'latest', dropped: frames.length - keep.length, kept: keep.length });
      return keep;
    }
    if (this.catchUpMode === 'drop-b' || this.catchUpMode === 'drop-bp') {
      const keep: DemuxedFrame[] = [];
      frames.forEach((f, idx) => {
        // keep keyframes always, and optionally keep every other P frame when drop-bp
        if (f.isKey || (this.catchUpMode === 'drop-bp' && idx % 2 === 0)) {
          keep.push(f);
        }
      });
      if (!keep.length) keep.push(frames[frames.length - 1]);
      this.droppedFrames += frames.length - keep.length;
      this.handlers?.onNetwork?.({ type: 'catchup', mode: this.catchUpMode, dropped: frames.length - keep.length, kept: keep.length });
      return keep;
    }
    // drop-to-key
    let startIdx = -1;
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].isKey) {
        startIdx = i;
        break;
      }
    }
    if (startIdx < 0) startIdx = Math.max(0, frames.length - 6);
    const sliced = frames.slice(startIdx);
    this.droppedFrames += startIdx;
    this.handlers?.onNetwork?.({ type: 'catchup', mode: 'drop-to-key', dropped: startIdx, kept: sliced.length });
    return sliced;
  }
}
