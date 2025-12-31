/**
 * EngineFactory - pluggable URL adapter.
 * Converts engine-specific publish/stream identifiers into Fyra Source URLs.
 *
 * Usage:
 *  - Register engines via registerEngine('mediamtx', (opts) => new MediaMtxEngine(opts))
 *  - Call convertUrl('mediamtx', input) to get standardized URLs + fallbackChain.
 *
 * This is intentionally lightweight; bring your own engine implementations
 * (e.g., migrate from ref/livepano adapters/engines).
 */

export interface EngineUrls {
  webrtcUrl?: string;
  whepUrl?: string;
  whepToken?: string;
  wsFlvUrl?: string;
  mseUrl?: string;
  hlsUrl?: string;
  llHlsUrl?: string;
  dashUrl?: string;
  fallbackChain?: string[];
}

export interface EngineConfig {
  [key: string]: unknown;
}

export interface Engine {
  convertUrl(input: string): EngineUrls | null | undefined;
  getFallbackChain(): string[] | undefined;
}

type EngineFactoryFn = (config?: EngineConfig) => Engine;

const ENGINE_MAP: Record<string, EngineFactoryFn> = {};
const USER_CONFIG: Record<string, EngineConfig> = {};

export const EngineFactory = {
  registerEngine(name: string, factory: EngineFactoryFn): void {
    ENGINE_MAP[name] = factory;
  },

  setConfig(configs: Record<string, EngineConfig>): void {
    Object.assign(USER_CONFIG, configs);
  },

  getEngineNames(): string[] {
    return Object.keys(ENGINE_MAP);
  },

  create(name: string, config?: EngineConfig): Engine {
    const fn = ENGINE_MAP[name];
    if (!fn) {
      throw new Error(`Unknown engine: ${name}. Registered: ${this.getEngineNames().join(', ') || 'none'}`);
    }
    const mergedConfig = { ...(USER_CONFIG[name] || {}), ...(config || {}) };
    return fn(mergedConfig);
  },

  convertUrl(name: string, input: string, config?: EngineConfig): EngineUrls {
    const engine = this.create(name, config);
    const urls = engine.convertUrl(input) || {};
    return {
      ...urls,
      wsFlvUrl:
        urls.wsFlvUrl ||
        urls.mseUrl?.replace(/^https?:\/\//, (m) => (m === 'https://' ? 'wss://' : 'ws://')),
      hlsUrl:
        urls.hlsUrl ||
        urls.mseUrl
          ?.replace(/\.flv$/, '.m3u8')
          ?.replace(/\.live\.flv$/, '/hls.m3u8'),
      fallbackChain: urls.fallbackChain || engine.getFallbackChain?.()
    };
  }
};
