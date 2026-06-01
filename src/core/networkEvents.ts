import type { PlayerNetworkCode, PlayerNetworkEvent, PlayerNetworkSeverity } from '../types.js';

export type NetworkEventPayload = PlayerNetworkEvent;

export type EnhancedNetworkEvent = NetworkEventPayload & {
  code: PlayerNetworkCode | (string & {});
  severity: PlayerNetworkSeverity;
  message: string;
};

const NETWORK_CODE_BY_TYPE: Record<string, PlayerNetworkCode> = {
  fallback: 'SOURCE_FALLBACK',
  reconnect: 'RECONNECT_ATTEMPT',
  'reconnect-exhausted': 'RECONNECT_EXHAUSTED',
  'connect-timeout': 'CONNECT_TIMEOUT',
  'autoplay-blocked': 'AUTOPLAY_BLOCKED',
  'metadata-timeout': 'METADATA_TIMEOUT',
  'auth-recovery-attempt': 'AUTH_RECOVERY_ATTEMPT',
  'auth-recovery-success': 'AUTH_RECOVERY_SUCCESS',
  'auth-recovery-failed': 'AUTH_RECOVERY_FAILED',
  'auth-recovery-skipped': 'AUTH_RECOVERY_SKIPPED',
  'video-error': 'VIDEO_ERROR',
  'hls-warning': 'HLS_WARNING',
  'hls-fatal': 'HLS_FATAL',
  'dash-error': 'DASH_ERROR',
  'fmp4-http-error': 'FMP4_HTTP_ERROR',
  'fmp4-ws-closed': 'FMP4_WS_CLOSED',
  'fmp4-backpressure': 'FMP4_BACKPRESSURE',
  'fmp4-quota-exceeded': 'FMP4_QUOTA_EXCEEDED',
  'fmp4-codec-selected': 'FMP4_CODEC_SELECTED',
  'fmp4-codec-unsupported': 'FMP4_CODEC_UNSUPPORTED',
  'hls-hevc-detected': 'HLS_HEVC_DETECTED',
  'hls-hevc-unsupported': 'HLS_HEVC_UNSUPPORTED',
  'ws-open': 'WS_OPEN',
  'ws-close': 'WS_CLOSE',
  'wt-open': 'WEBTRANSPORT_OPEN',
  'wt-close': 'WEBTRANSPORT_CLOSE',
  'ws-fallback-error': 'WS_RAW_FALLBACK_ERROR',
  'gb-fallback-error': 'GB28181_FALLBACK_ERROR',
  'gb-control': 'GB28181_CONTROL',
  disconnect: 'WEBRTC_DISCONNECTED',
  'ice-state': 'WEBRTC_ICE_STATE',
  'ice-failed': 'WEBRTC_ICE_FAILED',
  'ice-restart': 'WEBRTC_ICE_RESTART',
  'ice-restart-failed': 'WEBRTC_ICE_RESTART_FAILED',
  'ice-reconnect-required': 'WEBRTC_ICE_RECONNECT_REQUIRED',
  'signal-error': 'WEBRTC_SIGNAL_ERROR',
  error: 'WEBRTC_SIGNAL_ERROR',
  'parse-error': 'WEBRTC_SIGNAL_PARSE_ERROR',
  'ws-error': 'WEBRTC_SIGNAL_WS_ERROR',
  'whep-http-error': 'WEBRTC_WHEP_HTTP_ERROR',
  'whep-fetch-error': 'WEBRTC_SIGNAL_ERROR',
  'whep-timeout': 'WEBRTC_WHEP_TIMEOUT',
  'whep-answer-error': 'WEBRTC_WHEP_ANSWER_ERROR',
  'whep-ice-gathering-timeout': 'WEBRTC_WHEP_ICE_GATHERING_TIMEOUT',
  'webrtc-audio-muted': 'WEBRTC_AUDIO_MUTED',
  'offer-timeout': 'WEBRTC_OFFER_TIMEOUT',
  'offer-error': 'WEBRTC_OFFER_ERROR',
  notification: 'WEBRTC_NOTIFICATION',
  'webrtc-notification': 'WEBRTC_NOTIFICATION',
  playlist: 'WEBRTC_PLAYLIST',
  'webrtc-playlist': 'WEBRTC_PLAYLIST',
  'abr-rendition': 'ABR_RENDITION',
  'abr-change_rendition': 'ABR_RENDITION_CHANGED',
  'rendition-changed': 'ABR_RENDITION_CHANGED',
  'abr-fallback-error': 'ABR_FALLBACK_ERROR',
  'audio-disabled': 'AUDIO_DISABLED',
  'audio-fallback': 'AUDIO_FALLBACK',
  'video-decode-error': 'VIDEO_DECODE_ERROR',
  catchup: 'CATCHUP_DROP',
  jitter: 'JITTER_BUFFER',
  'webcodecs-config': 'WEBCODECS_CONFIG',
  'webcodecs-config-unsupported': 'WEBCODECS_CONFIG_UNSUPPORTED',
  'webcodecs-fallback': 'WEBCODECS_FALLBACK'
};

const WEBRTC_SIGNAL_CODE_BY_TYPE: Record<string, PlayerNetworkCode> = {
  'ws-open': 'WEBRTC_SIGNAL_WS_OPEN',
  'ws-close': 'WEBRTC_SIGNAL_WS_CLOSE',
  'ws-error': 'WEBRTC_SIGNAL_WS_ERROR'
};

const FATAL_EVENT_TYPES = new Set([
  'ice-failed',
  'ice-reconnect-required',
  'connect-timeout',
  'ws-fallback-error',
  'gb-fallback-error',
  'fmp4-http-error',
  'fmp4-ws-closed',
  'fatal',
  'signal-error',
  'whep-http-error',
  'whep-fetch-error',
  'whep-timeout',
  'whep-answer-error',
  'error',
  'offer-timeout',
  'reconnect-exhausted'
]);

const WARNING_EVENT_TYPES = new Set([
  'metadata-timeout',
  'autoplay-blocked',
  'audio-disabled',
  'audio-fallback',
  'video-decode-error',
  'catchup',
  'jitter',
  'hls-warning',
  'dash-error',
  'fmp4-backpressure',
  'fmp4-quota-exceeded',
  'hls-hevc-unsupported',
  'abr-rendition',
  'abr-fallback-error',
  'ice-restart-failed',
  'webrtc-audio-muted',
  'whep-ice-gathering-timeout',
  'webcodecs-config-unsupported',
  'webcodecs-fallback'
]);

export function normalizeNetworkCode(evt: NetworkEventPayload | undefined): PlayerNetworkCode | (string & {}) {
  if (typeof evt?.code === 'string' && evt.code.length > 0) {
    return evt.code;
  }
  if (evt?.stage === 'webrtc-signal' && typeof evt.type === 'string') {
    return WEBRTC_SIGNAL_CODE_BY_TYPE[evt.type] ?? NETWORK_CODE_BY_TYPE[evt.type] ?? 'WEBRTC_SIGNAL_EVENT';
  }
  if (typeof evt?.type === 'string') {
    return NETWORK_CODE_BY_TYPE[evt.type] ?? 'NETWORK_EVENT';
  }
  return 'NETWORK_EVENT';
}

export function normalizeNetworkSeverity(evt: NetworkEventPayload | undefined): PlayerNetworkSeverity {
  if (evt?.severity === 'fatal' || evt?.severity === 'warning' || evt?.severity === 'info') {
    return evt.severity;
  }
  if (evt?.fatal || (typeof evt?.type === 'string' && FATAL_EVENT_TYPES.has(evt.type))) {
    return 'fatal';
  }
  if ((evt as { warning?: unknown } | undefined)?.warning || (typeof evt?.type === 'string' && WARNING_EVENT_TYPES.has(evt.type))) {
    return 'warning';
  }
  return 'info';
}

export function isFatalNetworkEvent(evt: NetworkEventPayload | undefined): boolean {
  if (!evt) return false;
  if (evt.fatal) return true;
  return typeof evt.type === 'string' && FATAL_EVENT_TYPES.has(evt.type);
}

export function enhanceNetworkEvent(evt: NetworkEventPayload | undefined): EnhancedNetworkEvent | undefined {
  if (!evt) return evt;

  const enhanced: NetworkEventPayload = { ...evt };
  const code = normalizeNetworkCode(evt);
  const severity = normalizeNetworkSeverity(evt);
  const message = normalizeNetworkMessage(evt);

  return {
    ...enhanced,
    code,
    severity,
    message
  };
}

function normalizeNetworkMessage(evt: NetworkEventPayload): string {
  if (typeof evt.message === 'string' && evt.message.length > 0) return evt.message;

  switch (evt.type) {
    case 'whep-http-error':
      return `WHEP/WHIP HTTP error (${evt.status ?? 'unknown'})`;
    case 'whep-timeout':
      return `WHEP/WHIP signaling timeout (${evt.timeoutMs || 15000}ms)`;
    case 'whep-answer-error':
      return 'WHEP/WHIP answer SDP failed to apply';
    case 'whep-ice-gathering-timeout':
      return `WHEP/WHIP ICE gathering timed out (${evt.timeoutMs || 5000}ms); posting current local SDP`;
    case 'disconnect':
      return `连接断开 (状态: ${evt.state || 'unknown'})`;
    case 'ice-failed':
      return 'ICE 连接失败，正在尝试重连...';
    case 'connect-timeout':
      return `连接超时 (${evt.timeoutMs || 15000}ms)`;
    case 'signal-error':
    case 'error':
      return '信令连接失败';
    case 'offer-timeout':
      return 'SDP Offer 超时';
    case 'offer-error':
      return 'SDP Offer 处理失败';
    case 'ws-fallback-error':
      return 'WebSocket 回退失败';
    case 'gb-fallback-error':
      return 'GB28181 回退播放失败';
    case 'fmp4-http-error':
      return 'fMP4 HTTP 加载失败';
    case 'fmp4-ws-closed':
      return 'fMP4 WebSocket closed unexpectedly';
    case 'fmp4-backpressure':
      return `fMP4 pending buffer queue is full (${evt.pendingSegments ?? 'unknown'} segments, ${evt.pendingBytes ?? 'unknown'} bytes)`;
    case 'fmp4-quota-exceeded':
      return 'fMP4 SourceBuffer quota exceeded; old buffered media cleanup requested';
    case 'fmp4-codec-selected':
      return `fMP4 MIME selected: ${evt.mimeType || 'unknown'}`;
    case 'fmp4-codec-unsupported':
      return 'fMP4 MIME type is not supported by MediaSource';
    case 'hls-hevc-detected':
      return `HLS HEVC levels detected: ${Array.isArray(evt.codecs) ? evt.codecs.join(', ') : 'unknown'}`;
    case 'hls-hevc-unsupported':
      return `HLS HEVC levels are not supported by MediaSource: ${Array.isArray(evt.codecs) ? evt.codecs.join(', ') : 'unknown'}`;
    case 'reconnect-exhausted':
      return `Reconnect attempts exhausted (${evt.attempt || 0}/${evt.maxRetries || 0})`;
    case 'fallback':
      return `已从 ${evt.from || 'primary'} 切换到 ${evt.to || 'fallback'} 源`;
    case 'reconnect':
      return `正在重连 (第 ${evt.attempt}/${evt.maxRetries} 次)`;
    case 'audio-disabled':
      return `音频已禁用: ${evt.reason || 'unknown'}`;
    case 'audio-fallback':
      return `音频解码失败: ${evt.reason || 'unknown'}`;
    case 'video-decode-error':
      return `视频解码错误 (累计 ${evt.errors} 次)`;
    case 'video-error':
      return '视频元素播放错误';
    case 'autoplay-blocked':
      return '自动播放被浏览器阻止，请点击播放';
    case 'metadata-timeout':
      return '视频元数据加载超时';
    case 'auth-recovery-attempt':
      return `Auth recovery attempt ${evt.attempt ?? 'unknown'}/${evt.maxRetries ?? 'unknown'}`;
    case 'auth-recovery-success':
      return 'Auth recovery reloaded the current source';
    case 'auth-recovery-failed':
      return `Auth recovery failed: ${evt.reason || 'unknown'}`;
    case 'auth-recovery-skipped':
      return `Auth recovery skipped: ${evt.reason || 'unknown'}`;
    case 'catchup':
      return `追帧: 丢弃 ${evt.dropped} 帧，保留 ${evt.kept} 帧 (模式: ${evt.mode})`;
    case 'jitter':
      return `抖动缓冲: ${evt.size ?? 'unknown'}`;
    case 'ice-state':
      return `ICE 状态: ${evt.state}`;
    case 'ice-restart':
      return `正在重启 ICE: ${evt.reason || 'unknown'}`;
    case 'ice-restart-failed':
      return 'ICE 重启失败';
    case 'ice-reconnect-required':
      return evt.message || 'WebRTC ICE did not recover; reloading source';
    case 'webrtc-audio-muted':
      return 'WebRTC audio track is present but muted; check source codec and server transcoding';
    case 'ws-open':
      return evt.stage === 'webrtc-signal' ? '信令 WebSocket 连接已建立' : 'WebSocket 连接已建立';
    case 'ws-close':
      return evt.stage === 'webrtc-signal' ? '信令 WebSocket 连接已关闭' : 'WebSocket 连接已关闭';
    case 'ws-error':
      return '信令 WebSocket 错误';
    case 'wt-open':
      return 'WebTransport 连接已建立';
    case 'wt-close':
      return 'WebTransport 连接已关闭';
    case 'hls-warning':
      return `HLS 警告: ${evt.details || 'unknown'}`;
    case 'hls-fatal':
      return `HLS 致命错误: ${evt.details || 'unknown'}`;
    case 'dash-error':
      return 'DASH 网络或播放警告';
    case 'webrtc-notification':
    case 'notification':
      return `WebRTC 通知: ${evt.event || evt.reason || 'unknown'}`;
    case 'webrtc-playlist':
    case 'playlist':
      return `WebRTC 清晰度列表已更新 (${evt.renditionCount ?? 'unknown'})`;
    case 'abr-rendition':
    case 'abr-change_rendition':
    case 'rendition-changed':
      return `ABR 清晰度切换: ${evt.rendition || 'auto'}`;
    case 'abr-fallback-error':
      return 'ABR 回退失败';
    case 'gb-control':
      return 'GB28181 控制数据';
    case 'webcodecs-config':
      return `WebCodecs 配置已启用: ${evt.codec || 'unknown'}`;
    case 'webcodecs-config-unsupported':
      return `WebCodecs 配置不支持: ${evt.codec || 'unknown'}`;
    case 'webcodecs-fallback':
      return `WebCodecs 回退: ${evt.reason || 'unknown'}`;
    default:
      return `网络事件: ${evt.type || 'unknown'}`;
  }
}
