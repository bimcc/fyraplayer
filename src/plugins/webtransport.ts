import type { PluginCtor, Source } from '../types.js';
import { WebTransportTech, type WebTransportTechOptions } from './webtransport/tech.js';
export * from './webtransport/protocol.js';
export type { WebTransportTechOptions, WebTransportFrameInfo, WebTransportCertificateHash, WebTransportHandle } from './webtransport/tech.js';

export interface WebTransportSource {
  type: 'webtransport';
  /** HTTPS HTTP/3 WebTransport session URL; not an ordinary media GET URL. */
  url: string;
  allowH265?: boolean;
  preferTech?: 'webtransport';
  /** Explicit alternative browser playback endpoints, tried after startup failure. */
  fallbacks?: Source[];
}
declare module '../types.js' {
  interface CustomTechNameMap { webtransport: true; }
  interface CustomSourceMap { WebTransportSource: WebTransportSource; }
}
/** Optional video and raw metadata reliable-stream Tech; never installed by the Player core. */
export function createWebTransportTechPlugin(options: WebTransportTechOptions = {}): PluginCtor {
  return ({techs, lifecycle}) => {
    const tech = new WebTransportTech(options);
    const handle = techs.register('webtransport',tech,{techOrder:'append'});
    lifecycle?.onCleanup(() => handle.unregister());
    const cancel = () => tech.cancel();
    lifecycle?.signal.addEventListener('abort',cancel,{once:true});
    if (lifecycle?.signal.aborted) cancel();
    try { options.onHandle?.({getLatestFrame:() => tech.getLatestFrame()}); }
    catch(error) {
      cancel();lifecycle?.signal.removeEventListener('abort',cancel);
      if (!lifecycle) void handle.unregister().catch(() => {});
      throw error;
    }
    return {async destroy() {
      lifecycle?.signal.removeEventListener('abort',cancel);
      await handle.unregister();
    }};
  };
}
