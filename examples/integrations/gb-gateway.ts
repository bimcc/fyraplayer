import { FyraPlayer } from '../../src/player.js';
import { createGbGatewayAdapter, type GbGatewaySession, type GbGatewayReleaseReason } from '../../src/plugins/gb-gateway.js';
import type { AutoSource } from '../../src/types.js';

/** The application maps its actual gateway API; no SIP or endpoint guessing here. */
export interface GatewayApplicationApi {
  invite(channel: string, signal: AbortSignal): Promise<GbGatewaySession>;
  release(session: GbGatewaySession, reason: GbGatewayReleaseReason): Promise<void>;
  control(session: GbGatewaySession, action: string, payload: unknown, signal: AbortSignal): Promise<unknown>;
}

export function createGatewayPlayer(video: HTMLVideoElement, channel: string, api: GatewayApplicationApi) {
  const gateway = createGbGatewayAdapter({
    invite: (source, signal) => api.invite(source.url, signal),
    release: (session, reason) => api.release(session, reason),
    control: (session, action, payload, signal) => api.control(session, action, payload, signal),
    onError: error => console.warn('Gateway cleanup failed', error)
  });
  const source: AutoSource = { type: 'auto', engine: 'gb-gateway', url: channel };
  const player = new FyraPlayer({
    video, sources: [source], muted: true,
    middleware: [gateway.middleware], plugins: [gateway.plugin]
  });
  return { player, gateway };
}
