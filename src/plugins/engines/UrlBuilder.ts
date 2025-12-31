import { buildUrl, extractVars, parseUrl } from './urlConverter.js';
import { EngineUrls } from './engineFactory.js';

export function buildEngineUrls(opts: {
  inputUrl: string;
  webrtcPath?: string;
  webrtcPort?: number | string;
  webrtcUseWs?: boolean;  // Use ws:// instead of http:// for WebRTC
  hlsPath?: string;
  dashPath?: string;
  flvPath?: string;
  mp4Path?: string;
  useOrigin?: boolean;
  useHttps?: boolean;
}): EngineUrls {
  const parsed = parseUrl(opts.inputUrl);
  const vars = extractVars(parsed.pathname);
  const useHttps = opts.useHttps ?? false;
  const useOrigin = opts.useOrigin ?? false;

  // WebRTC URL - may use WebSocket protocol (ws/wss) for signaling
  let webrtcUrl: string | undefined;
  if (opts.webrtcPath) {
    if (opts.webrtcUseWs) {
      // Build WebSocket URL for WebRTC signaling
      const wsProtocol = useHttps ? 'wss' : 'ws';
      let path = opts.webrtcPath;
      Object.keys(vars).forEach((key) => {
        path = path.replace(new RegExp(`\\{${key}\\}`, 'g'), (vars as any)[key]);
      });
      const portStr = opts.webrtcPort ? `:${opts.webrtcPort}` : '';
      webrtcUrl = `${wsProtocol}://${parsed.hostname}${portStr}${path}`;
    } else {
      webrtcUrl = buildUrl(parsed.hostname, opts.webrtcPort, opts.webrtcPath, vars, useOrigin, useHttps);
    }
  }
  
  const hlsUrl = opts.hlsPath
    ? buildUrl(parsed.hostname, undefined, opts.hlsPath, vars, useOrigin, useHttps)
    : undefined;
  const dashUrl = opts.dashPath
    ? buildUrl(parsed.hostname, undefined, opts.dashPath, vars, useOrigin, useHttps)
    : undefined;
  const mseUrl = opts.flvPath
    ? buildUrl(parsed.hostname, undefined, opts.flvPath, vars, useOrigin, useHttps)
    : undefined;
  const mp4Url = opts.mp4Path
    ? buildUrl(parsed.hostname, undefined, opts.mp4Path, vars, useOrigin, useHttps)
    : undefined;

  return {
    webrtcUrl,
    hlsUrl,
    dashUrl,
    wsFlvUrl: mseUrl,
    mseUrl,
    llHlsUrl: hlsUrl,
    fallbackChain: []
  };
}
