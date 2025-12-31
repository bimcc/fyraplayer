import { Engine, EngineUrls } from './engineFactory.js';
import { DEFAULT_ENGINE_CONFIGS } from './constants.js';
import { buildEngineUrls } from './UrlBuilder.js';

export class TencentEngine implements Engine {
  private readonly config: typeof DEFAULT_ENGINE_CONFIGS.tencent;

  constructor(config: Partial<typeof DEFAULT_ENGINE_CONFIGS.tencent> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIGS.tencent, ...config };
  }

  convertUrl(input: string): EngineUrls {
    const host = this.config.playDomain || new URL(input.replace(/^(rtmp|rtsp):\/\//, 'http://')).hostname;
    const urls = buildEngineUrls({
      inputUrl: input.replace(/\/\/[^/]+/, `//${host}`),
      webrtcPath: this.config.webrtcPath,
      hlsPath: this.config.hlsPath,
      flvPath: this.config.flvPath,
      useHttps: this.config.useHttps,
      useOrigin: false
    });
    return { ...urls, fallbackChain: this.config.fallbackChain };
  }

  getFallbackChain(): string[] {
    return this.config.fallbackChain;
  }
}
