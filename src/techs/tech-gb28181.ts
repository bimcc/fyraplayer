import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, Gb28181Source, MetricsOptions, ReconnectPolicy, Source, WSRawSource } from '../types.js';
import { WsRawPipeline, type WsRawHandlers } from './wsRaw/pipeline.js';
import { MseFallback } from './wsRaw/mseFallback.js';
import { DEFAULT_H264_DECODER_URL } from './wsRaw/defaultDecoders.js';

type Base64OrBytes = string | Uint8Array | null | undefined;

interface GbStreamInfo {
  streamId?: string;
  codecVideo?: string;
  videoCodec?: string;
  codecAudio?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  ptsBase?: number;
  sps?: Base64OrBytes;
  pps?: Base64OrBytes;
  vps?: Base64OrBytes;
  asc?: Base64OrBytes;
  opusHead?: Base64OrBytes;
}

interface GbControlResponse extends Partial<GbStreamInfo> {
  url?: string;
  wsUrl?: string;
  streamInfo?: GbStreamInfo;
  callId?: string;
  dialogId?: string;
  ssrc?: string;
  [key: string]: unknown;
}

interface GbCodecHints {
  videoCodec?: 'h264' | 'h265';
  audioCodec?: 'aac' | 'pcma' | 'pcmu' | 'opus';
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  ptsBase?: number;
  sps?: Uint8Array;
  pps?: Uint8Array;
  vps?: Uint8Array;
  asc?: Uint8Array;
  opusHead?: Uint8Array;
}

interface GbInviteResult {
  url: string;
  streamInfo?: GbStreamInfo;
  callId?: string;
  ssrc?: string;
  streamId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getByPath(obj: unknown, path?: string): unknown {
  if (!path) return undefined;
  const keys = path.split('.').map((key) => key.trim()).filter(Boolean);
  if (!keys.length) return undefined;
  let current: unknown = obj;
  for (const key of keys) {
    if (!isRecord(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export class Gb28181Tech extends AbstractTech {
  private pipeline: WsRawPipeline | null = null;
  private fallback: MseFallback | null = null;
  private fallbackStarted = false;
  private session: { callId?: string; ssrc?: string; streamId?: string } = {};

  canPlay(source: Source): boolean {
    return source.type === 'gb28181';
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
    if (source.type !== 'gb28181') {
      throw new Error('Gb28181Tech only supports gb28181 source type');
    }
    const gbSource: Gb28181Source = { ...source };
    this.source = gbSource;
    this.buffer = opts.buffer;
    this.reconnect = opts.reconnect;
    this.metrics = opts.metrics;
    this.video = opts.video;
    this.cleanup();
    this.fallbackStarted = false;

    const invite = await this.performInvite(gbSource);
    const dataUrl = invite.url || gbSource.url;
    this.session = {
      callId: invite.callId,
      ssrc: invite.ssrc ?? gbSource.gb.ssrc,
      streamId: invite.streamId ?? invite.streamInfo?.streamId
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

    this.pipeline = new WsRawPipeline(wsSource, opts.video, opts.buffer, handlers, {
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
  async invoke(action: string, payload?: unknown): Promise<unknown> {
    if (!this.source) throw new Error('tech not loaded');
    const gb = this.source as Gb28181Source;
    switch (action) {
      case 'gb:invite':
        return this.performInvite(gb, payload);
      case 'gb:bye':
        return this.callControl(
          gb.control.bye,
          payload ?? {
            deviceId: gb.gb.deviceId,
            channelId: gb.gb.channelId,
            callId: this.session.callId,
            ssrc: this.session.ssrc,
            streamId: this.session.streamId
          }
        );
      case 'gb:ptz':
        return this.callControl(gb.control.ptz, {
          deviceId: gb.gb.deviceId,
          channelId: gb.gb.channelId,
          callId: this.session.callId,
          ssrc: this.session.ssrc,
          streamId: this.session.streamId,
          ...(typeof payload === 'object' && payload !== null ? payload : {}),
        });
      case 'gb:query':
        return this.callControl(gb.control.query, payload);
      case 'gb:keepalive':
        return this.callControl(gb.control.keepalive, payload ?? { callId: this.session.callId, ssrc: this.session.ssrc });
      default:
        throw new Error(`unsupported control action: ${action}`);
    }
  }

  private async performInvite(source: Gb28181Source, override?: unknown): Promise<GbInviteResult> {
    const inviteUrl = source.control.invite;
    if (!inviteUrl) {
      return { url: source.url };
    }
    const overrideRecord = typeof override === 'object' && override !== null
      ? (override as Record<string, unknown>)
      : {};
    const body = {
      deviceId: source.gb.deviceId,
      channelId: source.gb.channelId,
      ssrc: source.gb.ssrc,
      transport: source.gb.transport,
      expires: source.gb.expires,
      ...overrideRecord
    };
    const res = await fetch(inviteUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`gb28181 invite failed: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as GbControlResponse;
    const mappedUrl = asString(getByPath(json, source.responseMapping?.url));
    const mappedCallId = asString(getByPath(json, source.responseMapping?.callId));
    const mappedSsrc = asString(getByPath(json, source.responseMapping?.ssrc));
    const mappedStreamInfo = getByPath(json, source.responseMapping?.streamInfo);
    const mappedStreamId: string | undefined = asString(getByPath(json, source.responseMapping?.streamId));

    const streamInfoFromMapping = isRecord(mappedStreamInfo)
      ? (mappedStreamInfo as GbStreamInfo)
      : undefined;
    const streamInfoCandidate: GbStreamInfo | undefined =
      streamInfoFromMapping ?? json.streamInfo ?? (isRecord(json) ? (json as GbStreamInfo) : undefined);

    const defaultStreamId: string | undefined =
      asString((json as Record<string, unknown>).stream_id) ??
      asString((json as Record<string, unknown>).streamId) ??
      streamInfoCandidate?.streamId;

    const resolvedStreamId: string | undefined = mappedStreamId ?? defaultStreamId;

    return {
      url: mappedUrl ?? json.url ?? json.wsUrl ?? source.url,
      streamInfo: streamInfoCandidate,
      callId: mappedCallId ?? json.callId ?? json.dialogId,
      ssrc: mappedSsrc ?? json.ssrc ?? source.gb.ssrc,
      streamId: resolvedStreamId
    };
  }

  private async callControl(url?: string, payload?: unknown): Promise<unknown> {
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

  private toWsSource(source: Gb28181Source, url: string, info?: GbStreamInfo): WSRawSource {
    const hintedCodec = info?.codecVideo ?? info?.videoCodec ?? source.codecHints?.video;
    const videoCodec: 'h264' | 'h265' = hintedCodec === 'h265' ? 'h265' : 'h264';
    const transport = source.format ?? 'annexb';
    const decoderUrl =
      source.decoderUrl ?? (videoCodec === 'h264' ? DEFAULT_H264_DECODER_URL : undefined);
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

  private normalizeStreamInfo(info: GbStreamInfo | null | undefined): GbCodecHints | undefined {
    if (!info) return undefined;
    const decode = (v: Base64OrBytes): Uint8Array | undefined => {
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
    const audioCodec = info.codecAudio ?? info.audioCodec;
    return {
      videoCodec: (info.codecVideo ?? info.videoCodec) === 'h265' ? 'h265' : 'h264',
      audioCodec:
        audioCodec === 'opus' || audioCodec === 'pcma' || audioCodec === 'pcmu' || audioCodec === 'aac'
          ? audioCodec
          : undefined,
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
  }
}
