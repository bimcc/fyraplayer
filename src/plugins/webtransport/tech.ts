import { AbstractTech } from '../../techs/abstractTech.js';
import type { EngineStats, MetadataEvent, Source, TechLoadOptions } from '../../types.js';
import { abortReason, throwIfAborted, waitWithSignal } from '../../core/abort.js';
import { TransportVideoParser, WEBTRANSPORT_MEDIA_PROTOCOL, type TransportVideoPacket } from './protocol.js';

interface TransportSession {
  ready: Promise<unknown>;
  closed: Promise<unknown>;
  incomingUnidirectionalStreams: ReadableStream<ReadableStream<Uint8Array>>;
  close(): void;
}
type TransportConstructor = new (url:string, options?: {serverCertificateHashes?: WebTransportCertificateHash[]}) => TransportSession;
export interface WebTransportCertificateHash {
  algorithm: 'sha-256';
  value: Uint8Array;
}
export interface WebTransportFrameInfo {
  /** Original media PTS, in microseconds; independent of captureStream currentTime. */
  timestamp: number;
  mediaTime: number;
  width: number;
  height: number;
  /** Changes on each decoder configuration, including reconnect; local to this Tech. */
  timelineId: number;
}
export interface WebTransportHandle {
  /** Last canvas-drawn frame with original PTS; not a screen presentation callback. */
  getLatestFrame(): WebTransportFrameInfo | null;
}
export interface WebTransportTechOptions {
  /** Explicit certificate pins, primarily for short-lived local test certificates. */
  serverCertificateHashes?: WebTransportCertificateHash[];
  maxPacketBytes?: number;
  /** Bound VideoDecoder queue; preserve decoder warmup, then catch up at a keyframe. Default 8. */
  maxDecodeQueue?: number;
  /** Session/config/first decoded frame deadline. Default 15000ms. */
  startupTimeoutMs?: number;
  /** Sync-only frame callback: clone the frame if retaining it. */
  onFrame?(frame: VideoFrame, info: WebTransportFrameInfo): void;
  onHandle?(handle: WebTransportHandle): void;
}
type ActiveLoad = {
  controller: AbortController;
  startup: boolean;
  resolve: () => void;
  reject: (error:unknown) => void;
  unlink: () => void;
};

export class WebTransportTech extends AbstractTech {
  private session: TransportSession | null = null;
  private streams: ReadableStreamDefaultReader<ReadableStream<Uint8Array>> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private decoder: VideoDecoder | null = null;
  private config: VideoDecoderConfig | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private capture: MediaStream | null = null;
  private active: ActiveLoad | null = null;
  private generation = 0;
  private waitingKey = true;
  private decoderHasOutput = false;
  private paused = false;
  private ended = false;
  private frames = 0;
  private dropped = 0;
  private bytes = 0;
  private lastFrame: WebTransportFrameInfo | null = null;
  private timelineId = 0;
  private readonly queueLimit: number;
  constructor(private options:WebTransportTechOptions = {}) {
    super();
    this.queueLimit = options.maxDecodeQueue ?? 8;
    if (!Number.isInteger(this.queueLimit) || this.queueLimit < 1 || this.queueLimit > 128) throw new RangeError('Invalid maxDecodeQueue');
    if (!Number.isFinite(options.startupTimeoutMs ?? 15000) || (options.startupTimeoutMs ?? 15000) <= 0) throw new RangeError('Invalid startupTimeoutMs');
    // Validate framing limits before acquiring resources.
    new TransportVideoParser(options.maxPacketBytes);
    if (options.serverCertificateHashes?.some(hash => hash.algorithm !== 'sha-256' || hash.value.byteLength !== 32)) throw new RangeError('Expected 32-byte SHA-256 certificate hashes');
  }
  canPlay(source:Source): boolean { return source.type === 'webtransport'; }
  async load(source:Source, opts:TechLoadOptions): Promise<void> {
    this.cancel();
    throwIfAborted(opts.signal);
    if (source.type !== 'webtransport') throw new Error('WebTransport requires a webtransport source');
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('WebTransport requires an HTTPS session URL without URL credentials');
    const Constructor = (globalThis as typeof globalThis & {WebTransport?:TransportConstructor}).WebTransport;
    if (!Constructor || typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') throw new Error('WebTransport and WebCodecs are required');
    const controller = new AbortController();
    const signal = controller.signal;
    const generation = this.generation;
    const cancel = () => { if (this.active?.controller === controller) this.fail(abortReason(opts.signal!),generation); };
    opts.signal?.addEventListener('abort',cancel,{once:true});
    this.source = source; this.video = opts.video;
    this.frames = 0; this.bytes = 0; this.dropped = 0; this.lastFrame = null;
    this.paused = false; this.ended = false; this.waitingKey = true;
    const firstFrame = new Promise<void>((resolve,reject) => {
      this.active = {controller, startup:true, resolve, reject, unlink:() => opts.signal?.removeEventListener('abort',cancel)};
    });
    const timer = setTimeout(() => this.fail(new DOMException('WebTransport first frame timed out','TimeoutError'),generation),this.options.startupTimeoutMs ?? 15000);
    void this.run(source.url, Constructor, source.allowH265 === true, generation).catch(error => this.fail(error,generation));
    try {
      if (opts.signal?.aborted) cancel();
      await waitWithSignal(firstFrame,signal);
      throwIfAborted(signal);
      if (this.active?.controller === controller) {this.active.startup = false; this.active.unlink();}
    } catch(error) {
      if (generation === this.generation) this.cancel();
      throw error;
    } finally {clearTimeout(timer);}
  }
  private live(generation:number): boolean {
    return generation === this.generation && !!this.active && !this.active.controller.signal.aborted;
  }
  private async run(url:string, Constructor:TransportConstructor, allowH265:boolean, generation:number): Promise<void> {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context || typeof canvas.captureStream !== 'function') throw new Error('Canvas2D/captureStream is required for video presentation');
    this.canvas = canvas;
    const session = new Constructor(url, {serverCertificateHashes:this.options.serverCertificateHashes}); this.session = session;
    void session.closed.then(() => {
      if (this.live(generation) && !this.ended) this.fail(new Error('WebTransport session closed before video EOS'),generation);
    },error => this.fail(error,generation));
    const signal = this.active!.controller.signal;
    await waitWithSignal(session.ready,signal);
    if (!this.live(generation)) return;
    this.bus.emit('network',{type:'wt-open',protocol:WEBTRANSPORT_MEDIA_PROTOCOL});
    if (!this.live(generation)) return;
    const streams = session.incomingUnidirectionalStreams.getReader(); this.streams = streams;
    const next = await waitWithSignal(streams.read(),signal);
    if (!this.live(generation)) {if (next.value) void next.value.cancel().catch(() => {});return;}
    if (next.done || !next.value) throw new Error('WebTransport ended without a video stream');
    const reader = next.value.getReader(); this.reader = reader;
    const parser = new TransportVideoParser(this.options.maxPacketBytes);
    while (this.live(generation)) {
      const {value,done} = await waitWithSignal(reader.read(),signal);
      if (!this.live(generation)) return;
      if (done) {
        parser.finish();
        if (this.decoder?.state === 'configured') await waitWithSignal(this.decoder.flush(),signal);
        if (!this.live(generation)) return;
        if (!this.frames) throw new Error('WebTransport stream ended without decoded video');
        this.ended = true; this.bus.emit('ended'); return;
      }
      if (!value) continue;
      this.bytes += value.byteLength;
      for (const packet of parser.push(value)) {
        await this.consume(packet, allowH265, generation,context);
        if (!this.live(generation)) return;
      }
    }
  }
  private async consume(packet:TransportVideoPacket, allowH265:boolean, generation:number, context:CanvasRenderingContext2D): Promise<void> {
    if (packet.kind === 'config') {
      if (/^(hvc1|hev1)/.test(packet.config.codec) && !allowH265) throw new Error('Set source.allowH265=true to opt into HEVC');
      const support = await waitWithSignal(VideoDecoder.isConfigSupported(packet.config),this.active!.controller.signal);
      if (!this.live(generation)) return;
      if (!support.supported) throw new Error(`WebCodecs does not support ${packet.config.codec}`);
      const replacing = !!this.decoder;
      this.decoder?.close();
      this.lastFrame = null;
      this.timelineId++;
      if (replacing) this.bus.emit('streamchange',{reason:'discontinuity',source:this.source});
      if (!this.live(generation)) return;
      const decoder = new VideoDecoder({
        output:frame => {
          try {
            if (!this.live(generation) || this.decoder !== decoder || (this.paused && this.frames > 0)) return;
            const canvas = this.canvas!;
            if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
              canvas.width = frame.displayWidth; canvas.height = frame.displayHeight;
            }
            context.drawImage(frame,0,0,canvas.width,canvas.height);
            this.decoderHasOutput = true;
            if (!this.capture) {
              this.capture = canvas.captureStream();
              this.video!.srcObject = this.capture;
            }
            this.frames++;
            const info = {timestamp:frame.timestamp,mediaTime:frame.timestamp / 1e6,width:canvas.width,height:canvas.height,timelineId:this.timelineId};
            this.lastFrame = info;
            if (this.frames === 1) {this.active!.resolve();this.bus.emit('ready');}
            if (!this.live(generation)) return;
            this.options.onFrame?.(frame,{...info});
          } catch(error) {this.fail(error,generation);} finally {frame.close();}
        },
        error:error => {if (this.decoder === decoder) this.fail(error,generation);},
      });
      this.decoder = decoder;
      this.decoderHasOutput = false;
      this.config = {...packet.config,optimizeForLatency:true};
      decoder.configure(this.config);
      this.waitingKey = true;
      this.bus.emit('network',{type:'webcodecs-config',codec:packet.config.codec});
      return;
    }
    if (packet.kind === 'metadata') {
      const event:MetadataEvent = {type:packet.type,raw:packet.data,pts:packet.timestamp / 1000,timestampUs:packet.timestamp,
        ...(packet.identifier === undefined ? {} : packet.type === 'private-data' ? {pid:packet.identifier} : {seiType:packet.identifier})};
      this.bus.emit('metadata',event);
      return;
    }
    const decoder = this.decoder;
    if (!decoder || decoder.state !== 'configured') throw new Error('Missing video decoder config');
    if (this.paused && this.frames > 0) {this.dropped++;this.waitingKey = true;return;}
    if (decoder.decodeQueueSize >= this.queueLimit) {
      // Repeated reset/configure can discard the first keyframe before a slow
      // decoder finishes warming up. Keep that bounded prefix until it outputs.
      if (!this.decoderHasOutput) {
        this.dropped++;
        const notify = !this.waitingKey;
        this.waitingKey = true;
        if (notify) this.bus.emit('network',{type:'catchup',reason:'decode-queue-warmup',dropped:this.dropped,severity:'warning'});
        return;
      }
      this.waitingKey = true;
      this.decoderHasOutput = false;
      decoder.reset();
      decoder.configure(this.config!);
      if (!packet.key) this.dropped++;
      this.bus.emit('network',{type:'catchup',reason:'decode-queue',dropped:this.dropped,severity:'warning'});
      if (!this.live(generation) || this.paused || !packet.key) return;
    }
    if (this.waitingKey && !packet.key) {this.dropped++;return;}
    this.waitingKey = false;
    decoder.decode(new EncodedVideoChunk({type:packet.key?'key':'delta',timestamp:packet.timestamp,duration:packet.duration,data:packet.data}));
  }
  private fail(error:unknown,generation:number): void {
    if (!this.live(generation)) return;
    const startup = this.active!.startup;
    this.active!.reject(error);
    this.cancel(error);
    if (!startup) {
      this.bus.emit('error',error);
      this.bus.emit('network',{type:'wt-close',code:'WEBTRANSPORT_CLOSE',fatal:true,error});
    }
  }
  /** Immediately invalidates late reads/frames, including during pending session.ready. */
  cancel(reason:unknown = new DOMException('WebTransport cancelled','AbortError')): void {
    this.generation++;
    const active = this.active; this.active = null;
    active?.unlink(); active?.controller.abort(reason);
    active?.reject(reason);
    const reader = this.reader; this.reader = null;
    void reader?.cancel().catch(() => {});
    const streams = this.streams; this.streams = null;
    void streams?.cancel().catch(() => {});
    try {this.session?.close();} catch { /* already closed */ } this.session = null;
    try {this.decoder?.close();} catch { /* already closed */ } this.decoder = null;
    this.config = null;
    this.decoderHasOutput = false;
    this.lastFrame = null;
    this.capture?.getTracks().forEach(track => track.stop());
    if (this.video?.srcObject === this.capture && this.capture) {this.video.pause();this.video.srcObject = null;}
    this.capture = null; this.canvas = null;
  }
  override async play(): Promise<void> {
    if (!this.active || this.ended) throw new Error('No active WebTransport video');
    this.paused = false;
    await super.play();
  }
  override async pause(): Promise<void> {
    this.paused = true;this.waitingKey = true;
    this.decoderHasOutput = false;
    if (this.decoder?.state === 'configured' && this.config) {this.decoder.reset();this.decoder.configure(this.config);}
    await super.pause();
  }
  override async seek(): Promise<void> {throw new Error('WebTransport live video does not support seek');}
  getLatestFrame():WebTransportFrameInfo | null {return this.active && this.lastFrame ? {...this.lastFrame} : null;}
  override getStats():EngineStats {
    return {...super.getStats(),ts:Date.now(),width:this.lastFrame?.width,height:this.lastFrame?.height,droppedFrames:this.dropped,
      transport:'webtransport',codec:this.config?.codec,decodedFrames:this.frames,bytesReceived:this.bytes,mediaTime:this.lastFrame?.mediaTime};
  }
  override async destroy():Promise<void> {this.cancel();await super.destroy();}
}
