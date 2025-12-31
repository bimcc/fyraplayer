import { Engine, EngineUrls } from './engineFactory.js';
import { DEFAULT_ENGINE_CONFIGS } from './constants.js';
import { buildEngineUrls } from './UrlBuilder.js';

export class MediaMtxEngine implements Engine {
  private readonly config: typeof DEFAULT_ENGINE_CONFIGS.mediamtx;

  constructor(config: Partial<typeof DEFAULT_ENGINE_CONFIGS.mediamtx> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIGS.mediamtx, ...config };
  }

  convertUrl(input: string): EngineUrls {
    const urls = buildEngineUrls({
      inputUrl: input,
      webrtcPath: this.config.webrtcPath,
      webrtcPort: this.config.webrtcPort,
      hlsPath: this.config.hlsPath,
      useHttps: this.config.useHttps
    });
    return { ...urls, fallbackChain: this.config.fallbackChain };
  }

  getFallbackChain(): string[] {
    return this.config.fallbackChain;
  }
}
