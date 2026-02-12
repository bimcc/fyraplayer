import { PluginCtor } from '../types.js';

/**
 * Metrics plugin: subscribe onStats/onQoS and log/collect.
 * In real use, replace console with reporter endpoint.
 */
export const metricsPlugin: PluginCtor = ({ coreBus }) => {
  coreBus.on('stats', (payload: unknown) => {
    const payloadRecord = typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
    if (!payloadRecord?.stats) return;
    // TODO: send to endpoint
    console.debug('[metrics]', payloadRecord.stats);
  });
  coreBus.on('qos', (payload: unknown) => {
    // TODO: send qos
    console.debug('[qos]', payload);
  });
};
