import { Source, WebRTCSignalConfig } from "../../types.js";
import { OvenSignaling } from "./ovenSignaling.js";
import { WhipSignaling } from "./signaling.js";

export interface WebRTCSignalAdapter {
  type: string;
  /**
   * 完成信令协商并将媒体流绑定到 RTCPeerConnection。
   */
  setup(pc: RTCPeerConnection, src: Extract<Source, { type: "webrtc" }>, onEvent?: (evt: any) => void): Promise<void>;
  changeRendition?(renditionName?: string | null, auto?: boolean): void;
  destroy(): Promise<void>;
}

class OvenWsAdapter implements WebRTCSignalAdapter {
  type = "oven-ws";
  private sig: OvenSignaling | null = null;
  private pendingCandidates: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }> = [];
  private remoteDescriptionSet = false;

  constructor(private cfg: Extract<WebRTCSignalConfig, { type: "oven-ws" }>) {}

  async setup(pc: RTCPeerConnection, _src: Extract<Source, { type: "webrtc" }>, onEvent?: (evt: any) => void): Promise<void> {
    this.sig = new OvenSignaling(this.cfg, onEvent);
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;
    
    await this.sig.connect();
    
    // Handle remote offer from OME (with optional ICE servers)
    this.sig.onRemoteOffer(async (sdp, iceServers) => {
      try {
        // Update ICE servers if provided by OME
        if (iceServers && iceServers.length > 0) {
          try {
            const config = pc.getConfiguration();
            config.iceServers = iceServers;
            // In OME environments, prefer relay for stability (matches OvenPlayer)
            config.iceTransportPolicy = 'relay';
            pc.setConfiguration(config);
            console.log('[oven-adapter] Updated ICE servers from OME:', iceServers.length);
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
              // Pass the candidate object directly
              const candidate = new RTCIceCandidate(cand);
              await pc.addIceCandidate(candidate);
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
        // Pass the candidate object directly - let RTCIceCandidate handle the parsing
        // Don't override sdpMid/sdpMLineIndex if they're already set
        const candidate = new RTCIceCandidate(cand);
        await pc.addIceCandidate(candidate);
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
  }
  
  changeRendition(renditionName?: string | null, auto?: boolean): void {
    this.sig?.changeRendition(renditionName ?? undefined, auto);
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
      throw new Error(`Unsupported signaling type: ${(signal as any)?.type}`);
  }
}
