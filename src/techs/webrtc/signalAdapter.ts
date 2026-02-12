import { Source, WebRTCSignalConfig } from "../../types.js";
import { OvenSignaling } from "./ovenSignaling.js";
import { WhipSignaling } from "./signaling.js";

export type SignalAdapterEvent = {
  type: string;
  [key: string]: unknown;
};

export interface WebRTCSignalAdapter {
  type: string;
  /**
   * 完成信令协商并将媒体流绑定到 RTCPeerConnection。
   */
  setup(pc: RTCPeerConnection, src: Extract<Source, { type: "webrtc" }>, onEvent?: (evt: SignalAdapterEvent) => void): Promise<void>;
  changeRendition?(renditionName?: string | null, auto?: boolean): void;
  destroy(): Promise<void>;
}

class OvenWsAdapter implements WebRTCSignalAdapter {
  type = "oven-ws";
  private sig: OvenSignaling | null = null;
  private pendingCandidates: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }> = [];
  private remoteDescriptionSet = false;
  private wsHost: string | null = null;

  constructor(private cfg: Extract<WebRTCSignalConfig, { type: "oven-ws" }>) {}

  async setup(pc: RTCPeerConnection, _src: Extract<Source, { type: "webrtc" }>, onEvent?: (evt: SignalAdapterEvent) => void): Promise<void> {
    this.sig = new OvenSignaling(this.cfg, onEvent);
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.wsHost = this.extractWsHost(this.cfg.url);
    
    await this.sig.connect();
    
    // Handle remote offer from OME (with optional ICE servers)
    this.sig.onRemoteOffer(async (sdp, iceServers) => {
      try {
        // Update ICE servers if provided by OME
        if (iceServers && iceServers.length > 0) {
          try {
            const config = pc.getConfiguration();
            // Process ICE servers like OvenPlayer does
            const processedServers = this.processIceServers(iceServers);
            config.iceServers = processedServers;
            // Only use relay if we have TURN servers (urls containing 'turn:')
            const hasTurn = processedServers.some(s => 
              Array.isArray(s.urls) 
                ? s.urls.some(u => u.startsWith('turn:') || u.startsWith('turns:'))
                : (s.urls?.startsWith('turn:') || s.urls?.startsWith('turns:'))
            );
            if (hasTurn) {
              config.iceTransportPolicy = 'relay';
              console.log('[oven-adapter] Using relay mode (TURN available)');
            } else {
              // No TURN server, use default ICE behavior
              console.log('[oven-adapter] No TURN server, using default ICE policy');
            }
            pc.setConfiguration(config);
            console.log('[oven-adapter] Updated ICE servers from OME:', processedServers.length);
          } catch (e) {
            console.warn('[oven-adapter] Failed to update ICE servers:', e);
          }
        }
        
        console.log('[oven-adapter] Setting remote description (offer)');
        await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
        this.remoteDescriptionSet = true;
        
        // Process any pending ICE candidates
        if (this.pendingCandidates.length > 0) {
          console.log('[oven-adapter] Processing', this.pendingCandidates.length, 'pending ICE candidates');
          for (const cand of this.pendingCandidates) {
            try {
              await this.addIceCandidateWithFallback(pc, cand);
            } catch (e) {
              console.warn('[oven-adapter] Failed to add pending ICE candidate:', e);
            }
          }
          this.pendingCandidates = [];
        }

        
        console.log('[oven-adapter] Creating answer');
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('[oven-adapter] Local description set');
        this.sig?.sendAnswer(pc.localDescription || answer);
        onEvent?.({ type: "answer-sent" });
      } catch (err) {
        console.error('[oven-adapter] Failed to process offer:', err);
        onEvent?.({ type: "offer-error", error: err });
      }
    });
    
    // Handle remote ICE candidates
    this.sig.onRemoteCandidate(async (cand) => {
      if (!this.remoteDescriptionSet) {
        // Queue candidates until remote description is set
        console.log('[oven-adapter] Queuing ICE candidate (remote description not set yet)');
        this.pendingCandidates.push(cand);
        return;
      }
      
      try {
        await this.addIceCandidateWithFallback(pc, cand);
        onEvent?.({ type: "remote-candidate-added", cand });
      } catch (e) {
        console.warn('[oven-adapter] Failed to add ICE candidate:', e);
      }
    });
    
    // Send local ICE candidates to OME
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sig?.sendCandidate(e.candidate);
        onEvent?.({ type: "local-candidate", cand: e.candidate.candidate });
      }
    };
    
    try {
      await this.sig.waitOffer(10000);
    } catch (err) {
      onEvent?.({ type: "offer-timeout", fatal: true, error: err instanceof Error ? err.message : err });
      throw err;
    }
  }

  async destroy(): Promise<void> {
    await this.sig?.destroy();
    this.sig = null;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    this.wsHost = null;
  }
  
  changeRendition(renditionName?: string | null, auto?: boolean): void {
    this.sig?.changeRendition(renditionName ?? undefined, auto);
  }

  private extractWsHost(url: string): string | null {
    try {
      const parsed = new URL(url);
      return parsed.hostname || null;
    } catch {
      const match = url.match(/^(?:wss?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n\?\=]+)/im);
      return match?.[1] ?? null;
    }
  }

  /**
   * Process ICE servers like OvenPlayer does:
   * - Add WebSocket host variant to each server URL
   * - This helps with NAT traversal when the ICE server IP differs from WS host
   */
  private processIceServers(iceServers: RTCIceServer[]): RTCIceServer[] {
    const wsHost = this.wsHost;
    if (!wsHost) return iceServers;

    return iceServers.map(server => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls].filter(Boolean) as string[];
      const processedUrls = [...urls];
      
      // Check if any URL already contains the WS host
      const hasWsHost = urls.some(url => url.includes(wsHost));
      
      if (!hasWsHost && urls.length > 0) {
        // Clone first URL and replace IP with WS host (like OvenPlayer)
        const firstUrl = urls[0];
        const ip = this.findIp(firstUrl);
        if (ip && ip !== wsHost) {
          processedUrls.push(firstUrl.replace(ip, wsHost));
        }
      }
      
      return {
        ...server,
        urls: processedUrls,
        username: server.username,
        credential: server.credential
      };
    });
  }

  private findIp(candidate: string): string | null {
    const match = candidate.match(/\b(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/);
    return match?.[0] ?? null;
  }

  private isIp(value: string): boolean {
    return !!this.findIp(value);
  }

  private buildCandidateClone(
    cand: { candidate: string; sdpMid?: string; sdpMLineIndex?: number },
    host: string | null
  ): { candidate: string; sdpMid?: string; sdpMLineIndex?: number } | null {
    if (!host || !cand?.candidate) return null;
    const ip = this.findIp(cand.candidate);
    if (!ip || ip === host) return null;
    const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
    if (isFirefox && !this.isIp(host)) return null;
    return {
      ...cand,
      candidate: cand.candidate.replace(ip, host)
    };
  }

  private async addIceCandidateWithFallback(
    pc: RTCPeerConnection,
    cand: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }
  ): Promise<void> {
    // Add candidate as-is
    await pc.addIceCandidate(new RTCIceCandidate(cand));
    // Add a cloned candidate that replaces private IP with WS host (matches OvenPlayer)
    const clone = this.buildCandidateClone(cand, this.wsHost);
    if (clone) {
      await pc.addIceCandidate(new RTCIceCandidate(clone));
    }
  }
}

class WhipWhepAdapter implements WebRTCSignalAdapter {
  type = "whip/whep";
  private sig: WhipSignaling | null = null;

  constructor(private cfg: Extract<WebRTCSignalConfig, { type: "whip" | "whep" }>) {}

  async setup(pc: RTCPeerConnection, src: Extract<Source, { type: "webrtc" }>): Promise<void> {
    this.sig = new WhipSignaling({ url: this.cfg.url, token: this.cfg.token, iceServers: src.iceServers });
    pc.onicecandidate = null; // no trickle
    await this.sig.negotiate(pc);
  }

  async destroy(): Promise<void> {
    this.sig = null;
  }
}

export function createSignalAdapter(signal: WebRTCSignalConfig): WebRTCSignalAdapter {
  switch (signal.type) {
    case "oven-ws":
      return new OvenWsAdapter(signal);
    case "whip":
    case "whep":
      return new WhipWhepAdapter(signal);
    default:
      throw new Error("Unsupported signaling type");
  }
}
