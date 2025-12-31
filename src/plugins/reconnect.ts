import { PluginCtor } from '../types.js';

/**
 * Reconnect plugin: listens to network/error events and triggers hints.
 * Actual reconnect is handled by core tech order; here we surface logs/hooks.
 */
export const reconnectPlugin: PluginCtor = ({ coreBus }) => {
  coreBus.on('network', (evt: any) => {
    console.warn('[network]', evt);
  });
  coreBus.on('error', (err: any) => {
    console.error('[error]', err);
  });
};
