export interface WhipConfig {
  url: string; // WHIP endpoint
  token?: string;
  iceServers?: RTCIceServer[];
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  timeoutMs?: number;
  iceGatheringTimeoutMs?: number;
  onEvent?: (event: { type: string; [key: string]: unknown }) => void;
}

/**
 * WHIP signaling helper: single POST with offer (gather once, no trickle).
 */
export class WhipSignaling {
  constructor(private config: WhipConfig) {}

  async negotiate(pc: RTCPeerConnection): Promise<void> {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true, iceRestart: true });
    await pc.setLocalDescription(offer);
    await this.waitIceComplete(pc, this.config.iceGatheringTimeoutMs ?? 5000);
    const body = pc.localDescription?.sdp || '';
    const headers: Record<string, string> = { ...this.config.headers, 'Content-Type': 'application/sdp' };
    if (this.config.token) headers['Authorization'] = `Bearer ${this.config.token}`;
    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.config.url, {
        method: 'POST',
        headers,
        body,
        credentials: this.config.credentials,
        signal: controller.signal,
      });
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      this.config.onEvent?.({
        type: isAbort ? 'whep-timeout' : 'whep-fetch-error',
        fatal: true,
        timeoutMs,
        error,
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const responseText = await res.text().catch(() => '');
      this.config.onEvent?.({
        type: 'whep-http-error',
        fatal: true,
        status: res.status,
        statusText: res.statusText,
        responseText,
      });
      throw new Error(`WHEP/WHIP POST failed: ${res.status}`);
    }
    const answerSdp = await res.text();
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (error) {
      this.config.onEvent?.({
        type: 'whep-answer-error',
        fatal: true,
        error,
      });
      throw error;
    }
  }

  private waitIceComplete(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      let done = false;
      const finish = (timedOut: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        if (timedOut) {
          this.config.onEvent?.({
            type: 'whep-ice-gathering-timeout',
            warning: true,
            timeoutMs,
          });
        }
        resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          finish(false);
        }
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }
}
