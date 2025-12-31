import { Engine, EngineUrls } from './engineFactory.js';
import { DEFAULT_ENGINE_CONFIGS } from './constants.js';
import { buildEngineUrls } from './UrlBuilder.js';

export class ZlmEngine implements Engine {
  private readonly config: typeof DEFAULT_ENGINE_CONFIGS.zlm;

  constructor(config: Partial<typeof DEFAULT_ENGINE_CONFIGS.zlm> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIGS.zlm, ...config };
  }

  convertUrl(input: string): EngineUrls {
    const urls = buildEngineUrls({
      inputUrl: input,
      webrtcPath: this.config.webrtcPath,
      webrtcPort: this.config.httpPort,
      flvPath: this.config.flvPath,
      mp4Path: this.config.mp4Path,
      hlsPath: this.config.hlsPath,
      useHttps: this.config.useHttps
    });
    return { ...urls, fallbackChain: this.config.fallbackChain };
  }

  getFallbackChain(): string[] {
    return this.config.fallbackChain;
  }
}
