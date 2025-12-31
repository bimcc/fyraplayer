export interface WhipConfig {
  url: string; // WHIP endpoint
  token?: string;
  iceServers?: RTCIceServer[];
}

/**
 * WHIP signaling helper: single POST with offer (gather once, no trickle).
 */
export class WhipSignaling {
  constructor(private config: WhipConfig) {}

  async negotiate(pc: RTCPeerConnection): Promise<void> {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true, iceRestart: true });
    await pc.setLocalDescription(offer);
    await this.waitIceComplete(pc);
    const body = pc.localDescription?.sdp || '';
    const headers: Record<string, string> = { 'Content-Type': 'application/sdp' };
    if (this.config.token) headers['Authorization'] = `Bearer ${this.config.token}`;
    const res = await fetch(this.config.url, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(`WHIP POST failed: ${res.status}`);
    const answerSdp = await res.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }

  private waitIceComplete(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
}
