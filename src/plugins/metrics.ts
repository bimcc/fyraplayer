import { PluginCtor } from '../types.js';

/**
 * Metrics plugin: subscribe onStats/onQoS and log/collect.
 * In real use, replace console with reporter endpoint.
 */
export const metricsPlugin: PluginCtor = ({ coreBus }) => {
  coreBus.on('stats', (payload: any) => {
    if (!payload?.stats) return;
    // TODO: send to endpoint
    console.debug('[metrics]', payload.stats);
  });
  coreBus.on('qos', (payload: any) => {
    // TODO: send qos
    console.debug('[qos]', payload);
  });
};
