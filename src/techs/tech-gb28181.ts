import { AbstractTech } from './abstractTech.js';
import { BufferPolicy, Gb28181Source, MetricsOptions, ReconnectPolicy, Source } from '../types.js';
import { MseFallback } from './wsRaw/mseFallback.js';

interface GbStreamInfo {
  streamId?: string;
  [key: string]: unknown;
}

interface GbControlResponse {
  url?: string;
  wsUrl?: string;
  streamInfo?: GbStreamInfo;
  callId?: string;
  dialogId?: string;
  ssrc?: string;
  [key: string]: unknown;
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

function summarizeControlJsonError(json: Record<string, unknown>): string {
  const parts: string[] = [];
  const message = asString(json.message) ?? asString(json.error) ?? asString(json.reason);
  const code = asString(json.code);
  if (message) parts.push(message);
  if (code) parts.push(`code=${code}`);

  const details = isRecord(json.details) ? json.details : undefined;
  if (details) {
    const step = asString(details.step);
    if (step) parts.push(`step=${step}`);
    const inviteDebug = isRecord(details.invite_debug) ? details.invite_debug : undefined;
    if (inviteDebug) {
      const inviteStatus = typeof inviteDebug.invite_status === 'number' ? inviteDebug.invite_status : undefined;
      const inviteReason = asString(inviteDebug.invite_reason);
      if (inviteStatus !== undefined || inviteReason) {
        parts.push(`sip=${inviteStatus ?? '-'}${inviteReason ? ` ${inviteReason}` : ''}`);
      }
      const streamMode = asString(inviteDebug.stream_mode);
      if (streamMode) {
        parts.push(`stream_mode=${streamMode}`);
      }
    }
  }

  return parts.length ? parts.join(' | ') : JSON.stringify(json);
}

async function parseHttpErrorBody(res: Response): Promise<string | undefined> {
  const contentType = res.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      const json = (await res.json()) as Record<string, unknown>;
      return summarizeControlJsonError(json);
    }
    const text = (await res.text()).trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}

async function buildControlHttpError(action: 'invite' | 'control', res: Response): Promise<Error> {
  const parts = [`gb28181 ${action} failed: ${res.status} ${res.statusText}`];
  const body = await parseHttpErrorBody(res);
  if (body) {
    parts.push(`body=${body.length > 480 ? `${body.slice(0, 480)}...` : body}`);
  }
  if (res.status === 401 || res.status === 403) {
    parts.push('hint=control API requires auth; set source.controlRequest.headers.Authorization or source.controlRequest.credentials="include"');
  }
  return new Error(parts.join(' | '));
}

export class Gb28181Tech extends AbstractTech {
  private mse: MseFallback | null = null;
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

    const invite = await this.performInvite(gbSource);
    const mediaUrl = invite.url || gbSource.url;
    if (!mediaUrl) {
      throw new Error('gb28181 invite did not return a playable FLV/TS URL');
    }

    this.session = {
      callId: invite.callId,
      ssrc: invite.ssrc ?? gbSource.gb.ssrc,
      streamId: invite.streamId ?? invite.streamInfo?.streamId
    };

    this.mse = new MseFallback();
    this.mse.start(
      mediaUrl,
      opts.video,
      {
        onReady: () => this.bus.emit('ready'),
        onError: (e) => {
          this.bus.emit('error', e);
          this.bus.emit('network', { type: 'gb-fallback-error', fatal: true });
        }
      },
      this.resolveMseFormat(gbSource, mediaUrl)
    );
    this.bus.emit('network', {
      type: 'gb-control',
      action: 'invite',
      callId: this.session.callId,
      ssrc: this.session.ssrc,
      streamId: this.session.streamId
    });
  }

  override async destroy(): Promise<void> {
    this.cleanup();
    await super.destroy();
  }

  /**
   * Invoke GB28181 gateway control actions (invite/bye/ptz/query/keepalive).
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
      stream_mode: source.gb.streamMode,
      ssrc: source.gb.ssrc,
      transport: source.gb.transport,
      expires: source.gb.expires,
      ...overrideRecord
    };
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    };
    if (source.controlRequest?.headers) {
      requestInit.headers = {
        ...(requestInit.headers as Record<string, string>),
        ...source.controlRequest.headers
      };
    }
    if (source.controlRequest?.credentials) {
      requestInit.credentials = source.controlRequest.credentials;
    }
    const res = await fetch(inviteUrl, requestInit);
    if (!res.ok) {
      throw await buildControlHttpError('invite', res);
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
      streamInfoFromMapping ?? json.streamInfo;

    const fallbackUrl =
      json.url ??
      json.wsUrl ??
      asString(getByPath(json, 'play_urls.urls.ws_flv')) ??
      asString(getByPath(json, 'play_urls.ws_flv')) ??
      asString(getByPath(json, 'play_urls.urls.flv')) ??
      asString(getByPath(json, 'play_urls.urls.ws_ts')) ??
      asString(getByPath(json, 'play_urls.ws_ts'));

    const defaultStreamId: string | undefined =
      asString((json as Record<string, unknown>).stream_id) ??
      asString((json as Record<string, unknown>).streamId) ??
      streamInfoCandidate?.streamId;

    const resolvedStreamId: string | undefined = mappedStreamId ?? defaultStreamId;

    return {
      url: mappedUrl ?? fallbackUrl ?? source.url,
      streamInfo: streamInfoCandidate,
      callId: mappedCallId ?? json.callId ?? json.dialogId,
      ssrc: mappedSsrc ?? json.ssrc ?? source.gb.ssrc,
      streamId: resolvedStreamId
    };
  }

  private async callControl(url?: string, payload?: unknown): Promise<unknown> {
    if (!url) throw new Error('control endpoint not configured');
    const source = this.source?.type === 'gb28181' ? this.source : undefined;
    const requestInit: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload ?? {})
    };
    if (source?.controlRequest?.headers) {
      requestInit.headers = {
        ...(requestInit.headers as Record<string, string>),
        ...source.controlRequest.headers
      };
    }
    if (source?.controlRequest?.credentials) {
      requestInit.credentials = source.controlRequest.credentials;
    }
    const res = await fetch(url, {
      ...requestInit
    });
    if (!res.ok) {
      throw await buildControlHttpError('control', res);
    }
    try {
      return await res.json();
    } catch {
      return true;
    }
  }

  private resolveMseFormat(source: Gb28181Source, url: string): 'flv' | 'mpegts' {
    if (source.format === 'ts') return 'mpegts';
    if (source.format === 'flv') return 'flv';
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('.ts') || lowerUrl.includes('mpegts') || lowerUrl.includes('mp2t')
      ? 'mpegts'
      : 'flv';
  }

  private cleanup(): void {
    this.mse?.stop();
    this.mse = null;
    this.session = {};
  }
}
