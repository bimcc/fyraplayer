import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, Gb28181Source, MetricsOptions, ReconnectPolicy, Source } from '../types.js';
import { WsRawPipeline, type WsRawHandlers } from './wsRaw/pipeline.js';
import { MseFallback } from './wsRaw/mseFallback.js';
import { DEFAULT_H264_DECODER_URL, DEFAULT_H265_DECODER_URL } from './wsRaw/defaultDecoders.js';

interface GbInviteResult {
  url: string;
  streamInfo?: any;
  callId?: string;
  ssrc?: string;
}

export class Gb28181Tech extends AbstractTech {
  private pipeline: WsRawPipeline | null = null;
  private fallback: MseFallback | null = null;
  private fallbackStarted = false;
  private session: { callId?: string; ssrc?: string; streamId?: string } = {};
  private streamInfo: any = null;

  canPlay(source: Source): boolean {
    return (source as any).type === 'gb28181';
  }

  async load(
    source: Source,
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
      webCodecs?: import('../types.js').WebCodecsConfig;
    }
  ): Promise<void> {
    const gbSource = { ...(source as Gb28181Source) };
    this.source = gbSource;
    this.buffer = opts.buffer;
    this.reconnect = opts.reconnect;
    this.metrics = opts.metrics;
    this.video = opts.video;
    this.cleanup();
    this.fallbackStarted = false;

    const invite = await this.performInvite(gbSource);
    const dataUrl = invite.url || gbSource.url;
    this.streamInfo = invite.streamInfo;
    this.session = {
      callId: invite.callId,
      ssrc: invite.ssrc ?? gbSource.gb.ssrc,
      streamId: invite.streamInfo?.streamId
    };

    const wsSource = this.toWsSource(gbSource, dataUrl, invite.streamInfo);

    const startFallback = (reason?: string) => {
      if (this.fallbackStarted) return;
      this.fallbackStarted = true;
      this.pipeline?.stop();
      this.fallback = new MseFallback();
      this.fallback.start(dataUrl, opts.video, {
        onReady: () => this.bus.emit('ready'),
        onError: (e) => {
          this.bus.emit('error', e);
          this.bus.emit('network', { type: 'gb-fallback-error', fatal: true });
        }
      });
      if (reason) this.bus.emit('network', { type: 'fallback', reason });
    };

    const handlers: WsRawHandlers = {
      onReady: () => this.bus.emit('ready'),
      onError: (e) => {
        this.bus.emit('error', e);
        startFallback('pipeline-error');
      },
      onNetwork: (evt) => {
        this.bus.emit('network', evt);
      },
      onFallback: (reason) => startFallback(reason)
    };

    this.pipeline = new WsRawPipeline(wsSource as any, opts.video, opts.buffer, handlers, {
      webCodecsConfig: opts.webCodecs,
      gbMode: true,
      gbCodecHints: this.normalizeStreamInfo(invite.streamInfo)
    });
    await this.pipeline.start();
  }

  override async destroy(): Promise<void> {
    this.cleanup();
    await super.destroy();
  }

  /**
   * Invoke GB28181 control actions (invite/bye/ptz/query/keepalive).
   */
  async invoke(action: string, payload?: any): Promise<any> {
    if (!this.source) throw new Error('tech not loaded');
    const gb = this.source as Gb28181Source;
    switch (action) {
      case 'gb:invite':
        return this.performInvite(gb, payload);
      case 'gb:bye':
        return this.callControl(gb.control.bye, payload ?? { callId: this.session.callId, ssrc: this.session.ssrc });
      case 'gb:ptz':
        return this.callControl(gb.control.ptz, { ...payload, callId: this.session.callId, ssrc: this.session.ssrc });
      case 'gb:query':
        return this.callControl(gb.control.query, payload);
      case 'gb:keepalive':
        return this.callControl(gb.control.keepalive, payload ?? { callId: this.session.callId, ssrc: this.session.ssrc });
      default:
        throw new Error(`unsupported control action: ${action}`);
    }
  }

  private async performInvite(source: Gb28181Source, override?: any): Promise<GbInviteResult> {
    const inviteUrl = source.control.invite;
    if (!inviteUrl) {
      return { url: source.url };
    }
    const body = {
      deviceId: source.gb.deviceId,
      channelId: source.gb.channelId,
      ssrc: source.gb.ssrc,
      transport: source.gb.transport,
      expires: source.gb.expires,
      ...override
    };
    const res = await fetch(inviteUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`gb28181 invite failed: ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    return {
      url: json.url || json.wsUrl || source.url,
      streamInfo: json.streamInfo ?? json,
      callId: json.callId ?? json.dialogId,
      ssrc: json.ssrc ?? body.ssrc
    };
  }

  private async callControl(url?: string, payload?: any): Promise<any> {
    if (!url) throw new Error('control endpoint not configured');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {})
    });
    if (!res.ok) {
      throw new Error(`gb28181 control failed: ${res.status} ${res.statusText}`);
    }
    try {
      return await res.json();
    } catch {
      return true;
    }
  }

  private toWsSource(source: Gb28181Source, url: string, info?: any) {
    const videoCodec = info?.codecVideo ?? info?.videoCodec ?? source.codecHints?.video ?? 'h264';
    const transport = source.format ?? 'annexb';
    const decoderUrl =
      source.decoderUrl ??
      (videoCodec === 'h265' ? DEFAULT_H265_DECODER_URL : DEFAULT_H264_DECODER_URL);
    const audioOptional = source.audioOptional ?? true;
    return {
      type: 'ws-raw',
      url,
      codec: videoCodec,
      transport,
      heartbeatMs: source.heartbeatMs,
      decoderUrl,
      audioOptional,
      disableAudio: audioOptional === false ? false : undefined,
      webTransport: source.webTransport
    };
  }

  private normalizeStreamInfo(info: any): any {
    if (!info) return undefined;
    const decode = (v: any): Uint8Array | undefined => {
      if (!v) return undefined;
      if (v instanceof Uint8Array) return v;
      try {
        const bin = atob(v);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      } catch {
        return undefined;
      }
    };
    return {
      videoCodec: info.codecVideo ?? info.videoCodec,
      audioCodec: info.codecAudio ?? info.audioCodec,
      width: info.width,
      height: info.height,
      sampleRate: info.sampleRate,
      channels: info.channels,
      ptsBase: info.ptsBase,
      sps: decode(info.sps),
      pps: decode(info.pps),
      vps: decode(info.vps),
      asc: decode(info.asc),
      opusHead: decode(info.opusHead)
    };
  }

  private cleanup(): void {
    this.pipeline?.stop();
    this.pipeline = null;
    this.fallback?.stop();
    this.fallback = null;
    this.session = {};
    this.streamInfo = null;
  }
}
