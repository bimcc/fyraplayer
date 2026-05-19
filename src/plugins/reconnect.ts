import { PluginCtor } from '../types.js';

export interface ReconnectPluginOptions {
  onNetwork?: (event: unknown) => void;
  onError?: (error: unknown) => void;
  logNetwork?: boolean;
  logError?: boolean;
}

/**
 * Reconnect plugin: listens to network/error events and triggers hints.
 * Actual reconnect is handled by core tech order; here we surface logs/hooks.
 */
export function createReconnectPlugin(options: ReconnectPluginOptions = {}): PluginCtor {
  return ({ coreBus }) => {
    const networkHandler = (evt: unknown) => {
      options.onNetwork?.(evt);
      if (options.logNetwork !== false) {
        console.warn('[network]', evt);
      }
    };
    const errorHandler = (err: unknown) => {
      options.onError?.(err);
      if (options.logError !== false) {
        console.error('[error]', err);
      }
    };

    coreBus.on('network', networkHandler);
    coreBus.on('error', errorHandler);

    return {
      destroy: () => {
        coreBus.off('network', networkHandler);
        coreBus.off('error', errorHandler);
      },
    };
  };
}
