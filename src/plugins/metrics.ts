import { EngineStats, PlayerQosEvent, PluginCtor, TechName } from '../types.js';

export interface MetricsEventPayload {
  tech?: TechName | null;
  stats?: EngineStats;
  [key: string]: unknown;
}

export interface MetricsPluginOptions {
  /** Called for player `stats` events that include a stats payload. */
  onStats?: (payload: MetricsEventPayload) => void;
  /** Called for player `qos` events. */
  onQos?: (payload: PlayerQosEvent | undefined) => void;
  /** Called for every handled metrics/qos event after specific callbacks run. */
  onEvent?: (event: 'stats' | 'qos', payload: unknown) => void;
}

function asMetricsPayload(payload: unknown): MetricsEventPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as MetricsEventPayload;
  if (!record.stats) return null;
  return record;
}

function asQosPayload(payload: unknown): PlayerQosEvent | undefined {
  if (payload === undefined) return undefined;
  if (typeof payload !== 'object' || payload === null) return undefined;
  return payload as PlayerQosEvent;
}

export function createMetricsPlugin(options: MetricsPluginOptions = {}): PluginCtor {
  return ({ coreBus }) => {
    const statsHandler = (payload: unknown) => {
      const metricsPayload = asMetricsPayload(payload);
      if (!metricsPayload) return;
      options.onStats?.(metricsPayload);
      options.onEvent?.('stats', metricsPayload);
    };
    const qosHandler = (payload: unknown) => {
      const qosPayload = asQosPayload(payload);
      options.onQos?.(qosPayload);
      options.onEvent?.('qos', qosPayload);
    };

    coreBus.on('stats', statsHandler);
    coreBus.on('qos', qosHandler);

    return {
      destroy: () => {
        coreBus.off('stats', statsHandler);
        coreBus.off('qos', qosHandler);
      }
    };
  };
}

/**
 * Backwards-compatible default metrics plugin.
 * Prefer `createMetricsPlugin()` for production reporters.
 */
export const metricsPlugin: PluginCtor = createMetricsPlugin({
  onStats: (payload) => {
    console.debug('[metrics]', payload.stats);
  },
  onQos: (payload) => {
    console.debug('[qos]', payload);
  }
});
