import type { PlayerQosCode, PlayerQosEvent, PlayerQosSeverity, TechName } from '../types.js';

export type QosEventPayload = PlayerQosEvent;

export type EnhancedQosEvent = QosEventPayload & {
  code: PlayerQosCode | (string & {});
  severity: PlayerQosSeverity;
  message: string;
  tech: TechName;
  ts: number;
};

const QOS_CODE_BY_TYPE: Record<string, PlayerQosCode> = {
  'performance-budget': 'PERFORMANCE_BUDGET',
  'webcodecs-config': 'WEBCODECS_CONFIG',
  'webcodecs-ts-warning': 'WEBCODECS_TS_WARNING',
  'webcodecs-config-unsupported': 'WEBCODECS_CONFIG_UNSUPPORTED',
  'webcodecs-fallback': 'WEBCODECS_FALLBACK'
};

const WARNING_QOS_TYPES = new Set([
  'performance-budget',
  'webcodecs-ts-warning',
  'webcodecs-config-unsupported',
  'webcodecs-fallback'
]);

export function enhanceQosEvent(evt: QosEventPayload | undefined, tech: TechName): EnhancedQosEvent | undefined {
  if (!evt) return evt;

  const code = normalizeQosCode(evt);
  const severity = normalizeQosSeverity(evt);
  const message = normalizeQosMessage(evt);

  return {
    ...evt,
    code,
    severity,
    message,
    tech: evt.tech ?? tech,
    ts: typeof evt.ts === 'number' ? evt.ts : Date.now()
  };
}

function normalizeQosCode(evt: QosEventPayload): PlayerQosCode | (string & {}) {
  if (typeof evt.code === 'string' && evt.code.length > 0) {
    return evt.code;
  }
  if (typeof evt.type === 'string') {
    return QOS_CODE_BY_TYPE[evt.type] ?? 'QOS_EVENT';
  }
  return 'QOS_EVENT';
}

function normalizeQosSeverity(evt: QosEventPayload): PlayerQosSeverity {
  if (evt.severity === 'warning' || evt.severity === 'info') {
    return evt.severity;
  }
  if (typeof evt.type === 'string' && WARNING_QOS_TYPES.has(evt.type)) {
    return 'warning';
  }
  return 'info';
}

function normalizeQosMessage(evt: QosEventPayload): string {
  if (typeof evt.message === 'string' && evt.message.length > 0) return evt.message;

  switch (evt.type) {
    case 'performance-budget':
      return `Performance budget warning: ${evt.reason || 'unknown'}`;
    case 'webcodecs-config':
      return `WebCodecs 配置已启用: ${evt.codec || 'unknown'}`;
    case 'webcodecs-ts-warning':
      return `WebCodecs TS 解码警告: ${evt.decodeErrors ?? 0} errors, ${evt.decodedFrames ?? 0} frames`;
    case 'webcodecs-config-unsupported':
      return `WebCodecs 配置不支持: ${evt.codec || 'unknown'}`;
    case 'webcodecs-fallback':
      return `WebCodecs 回退: ${evt.reason || 'unknown'}`;
    default:
      return `QoS 事件: ${evt.type || 'unknown'}`;
  }
}
