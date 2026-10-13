import { abortReason, createLoadScope, throwIfAborted, waitWithSignal } from '../../core/abort.js';

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

  async negotiate(pc: RTCPeerConnection, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    const offer = await waitWithSignal(pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true, iceRestart: true }), signal);
    throwIfAborted(signal);
    await waitWithSignal(pc.setLocalDescription(offer), signal);
    await this.waitIceComplete(pc, this.config.iceGatheringTimeoutMs ?? 5000, signal);
    throwIfAborted(signal);
    const body = pc.localDescription?.sdp || '';
    const headers: Record<string, string> = { ...this.config.headers, 'Content-Type': 'application/sdp' };
    if (this.config.token) headers['Authorization'] = `Bearer ${this.config.token}`;
    const timeoutMs = this.config.timeoutMs ?? 15000;
    const scope = createLoadScope(signal, timeoutMs);
    let stage: 'fetch' | 'answer' = 'fetch';
    let reported = false;
    try {
      const res = await waitWithSignal(fetch(this.config.url, {
        method: 'POST',
        headers,
        body,
        credentials: this.config.credentials,
        signal: scope.signal,
      }).then(response => {
        if (scope.signal.aborted) void response.body?.cancel().catch(() => {});
        throwIfAborted(scope.signal);
        return response;
      }), scope.signal);
      if (!res.ok) {
        const responseText = await waitWithSignal(res.text().catch(() => ''), scope.signal);
        reported = true;
        this.config.onEvent?.({
          type: 'whep-http-error', fatal: true,
          status: res.status, statusText: res.statusText, responseText,
        });
        throw new Error(`WHEP/WHIP POST failed: ${res.status}`);
      }
      const answerSdp = await waitWithSignal(res.text(), scope.signal);
      throwIfAborted(scope.signal);
      stage = 'answer';
      await waitWithSignal(pc.setRemoteDescription({ type: 'answer', sdp: answerSdp }), scope.signal);
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      if (!reported) this.config.onEvent?.({
        type: scope.signal.aborted ? 'whep-timeout' : stage === 'answer' ? 'whep-answer-error' : 'whep-fetch-error',
        fatal: true,
        timeoutMs, error,
      });
      throw error;
    } finally {
      scope.dispose();
    }
  }

  private waitIceComplete(pc: RTCPeerConnection, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      let done = false;
      const finish = (timedOut: boolean, error?: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        signal?.removeEventListener('abort', cancel);
        if (timedOut) {
          this.config.onEvent?.({
            type: 'whep-ice-gathering-timeout',
            warning: true,
            timeoutMs,
          });
        }
        if (error !== undefined) reject(error);
        else resolve();
      };
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          finish(false);
        }
      };
      const cancel = () => {
        finish(false, signal && abortReason(signal));
      };
      const timer = setTimeout(() => finish(true), timeoutMs);
      pc.addEventListener('icegatheringstatechange', check);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }
}
