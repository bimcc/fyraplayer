import { Engine, EngineUrls } from './engineFactory.js';
import { DEFAULT_ENGINE_CONFIGS } from './constants.js';
import { parseUrl, extractVars } from './urlConverter.js';

type PathVarKey = keyof ReturnType<typeof extractVars>;

/**
 * OvenEngine - URL converter for OvenMediaEngine.
 * 
 * Converts publish URLs (RTMP/RTSP) to playback URLs (WebRTC/HLS/DASH).
 * 
 * Note: For direct wss:// playback URLs, the player core (tech-webrtc.ts) 
 * automatically detects and uses oven-ws signaling - no Engine needed.
 */
export class OvenEngine implements Engine {
  private readonly config: typeof DEFAULT_ENGINE_CONFIGS.oven;

  constructor(config: Partial<typeof DEFAULT_ENGINE_CONFIGS.oven> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIGS.oven, ...config };
  }

  /**
   * Convert a publish URL (RTMP/RTSP) to playback URLs.
   */
  convertUrl(input: string): EngineUrls {
    const parsed = parseUrl(input);
    const vars = extractVars(parsed.pathname);
    
    const { wsPort, httpPort, useHttps } = this.config;
    const wsProtocol = useHttps ? 'wss' : 'ws';
    const httpProtocol = useHttps ? 'https' : 'http';
    
    // Build WebRTC WebSocket URL
    let webrtcPath = this.config.webrtcPath || '/{fullPath}';
    (Object.keys(vars) as PathVarKey[]).forEach((key) => {
      webrtcPath = webrtcPath.replace(new RegExp(`\\{${key}\\}`, 'g'), vars[key]);
    });
    const webrtcUrl = `${wsProtocol}://${parsed.hostname}:${wsPort}${webrtcPath}`;
    
    // Build LL-HLS URL
    let llHlsPath = this.config.llHlsPath || '/{fullPath}/llhls.m3u8';
    (Object.keys(vars) as PathVarKey[]).forEach((key) => {
      llHlsPath = llHlsPath.replace(new RegExp(`\\{${key}\\}`, 'g'), vars[key]);
    });
    const llHlsUrl = `${httpProtocol}://${parsed.hostname}:${httpPort}${llHlsPath}`;
    
    // Build DASH URL
    let dashPath = this.config.dashPath || '/{fullPath}/manifest.mpd';
    (Object.keys(vars) as PathVarKey[]).forEach((key) => {
      dashPath = dashPath.replace(new RegExp(`\\{${key}\\}`, 'g'), vars[key]);
    });
    const dashUrl = `${httpProtocol}://${parsed.hostname}:${httpPort}${dashPath}`;
    
    return {
      webrtcUrl,
      llHlsUrl,
      hlsUrl: llHlsUrl,
      dashUrl,
      fallbackChain: this.config.fallbackChain
    };
  }

  getFallbackChain(): string[] {
    return this.config.fallbackChain;
  }
}
