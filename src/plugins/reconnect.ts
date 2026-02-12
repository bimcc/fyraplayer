import { PluginCtor } from '../types.js';

/**
 * Reconnect plugin: listens to network/error events and triggers hints.
 * Actual reconnect is handled by core tech order; here we surface logs/hooks.
 */
export const reconnectPlugin: PluginCtor = ({ coreBus }) => {
  coreBus.on('network', (evt: unknown) => {
    console.warn('[network]', evt);
  });
  coreBus.on('error', (err: unknown) => {
    console.error('[error]', err);
  });
};
