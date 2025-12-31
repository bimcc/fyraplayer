import { WebRTCSignalConfig } from "../../types.js";

interface OvenMessage {
  command: "offer" | "answer" | "candidate" | "ping" | "pong" | "request_offer" | "stop" | "error" | "notification";
  sdp?: string | { sdp: string; type: string };
  candidates?: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }>;
  candidate?: string;
  id?: string;
  peer_id?: string;
  stream_id?: string;
  iceServers?: Array<{ urls: string; username?: string; user_name?: string; credential?: string }>;
  ice_servers?: Array<{ urls: string; username?: string; user_name?: string; credential?: string }>;
  code?: number;
  error?: string;
  reason?: string;
  notification?: any;
  event?: string;
  type?: string;
  message?: any;
  auto?: boolean;
}

/**
 * OvenSignaling: WebSocket-based signaling for OvenMediaEngine.
 * Based on OvenPlayer's signaling implementation.
 * Supports Trickle ICE with proper candidate exchange.
 */
export class OvenSignaling {
  private ws: WebSocket | null = null;
  private config: Extract<WebRTCSignalConfig, { type: "oven-ws" }>;
  private onOffer?: (sdp: string, iceServers?: RTCIceServer[]) => void;
  private onCandidate?: (cand: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }) => void;
  private resolveReady?: () => void;
  private eventCb?: (evt: any) => void;
  private answerAcknowledged = false;
  private connectionConfigPolicy: RTCIceTransportPolicy | undefined;
  
  // OME connection identifiers (from offer message)
  private connectionId: string | null = null;
  private peerId: string | null = null;

  constructor(config: Extract<WebRTCSignalConfig, { type: "oven-ws" }>, onEvent?: (evt: any) => void) {
    this.config = config;
    this.eventCb = onEvent;
  }

  async connect(): Promise<void> {
    if (this.ws) return;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.config.url);
      this.ws = ws;
      ws.onopen = () => {
        console.log('[oven] WebSocket connected, requesting offer...');
        this.eventCb?.({ type: "ws-open" });
        // OME expects request_offer command
        this.send({ command: "request_offer" });
        resolve();
      };
      ws.onerror = (e) => {
        console.error('[oven] WebSocket error:', e);
        this.eventCb?.({ type: "ws-error", error: e });
        reject(e);
      };
      ws.onmessage = (evt) => this.handleMessage(evt);
      ws.onclose = (evt) => {
        const wasClean = evt.wasClean;
        console.log(`[oven] WebSocket closed: code=${evt.code}, reason=${evt.reason}, wasClean=${wasClean}`);
        this.eventCb?.({ 
          type: "ws-close", 
          fatal: !wasClean,
          code: evt.code,
          reason: evt.reason 
        });
        this.ws = null;
      };
    });
  }


  private handleMessage(evt: MessageEvent): void {
    try {
      const msg: OvenMessage = JSON.parse(evt.data);
      
      // Handle empty messages (OME sometimes sends these)
      if (Object.keys(msg).length === 0) {
        console.log('[oven] Received empty message, ignoring');
        return;
      }
      
      console.log('[oven] Received message:', msg.command, msg);
      
      // Handle error messages from OME
      if (msg.error || msg.command === 'error' || (msg.code !== undefined && msg.code !== 200)) {
        const errorMsg = msg.error || msg.reason || `OME error code: ${msg.code}`;
        console.warn(`[oven] Server error: ${errorMsg}`);
        this.eventCb?.({ type: 'error', error: new Error(errorMsg), fatal: true });
        return;
      }
      
      switch (msg.command) {
        case "ping":
          // Respond to ping with pong
          console.log('[oven] Received ping, sending pong');
          this.send({ command: "pong" });
          break;
          
        case "offer":
          this.handleOffer(msg);
          break;
          
        case "candidate":
          this.handleCandidate(msg);
          break;
          
      case "answer":
        // Answer acknowledgment from OME
        this.answerAcknowledged = true;
        console.log('[oven] Answer acknowledged by server');
        this.eventCb?.({ type: "answer-ack" });
        break;
      
      case "notification":
        this.handleNotification(msg);
        break;
          
        default:
          console.log('[oven] Unknown command:', msg.command);
          break;
      }
    } catch (e) {
      console.warn("[oven] Parse message error:", e);
      this.eventCb?.({ type: "parse-error", error: e });
    }
  }

  private handleNotification(msg: OvenMessage): void {
    const payload = msg.notification ?? msg.message ?? msg;
    const eventType = msg.type ?? payload?.event ?? payload?.type;
    
    if (eventType === "playlist") {
      this.eventCb?.({
        type: "playlist",
        playlist: payload?.renditions ?? payload?.message?.renditions ?? [],
        auto: payload?.auto ?? msg.auto
      });
      return;
    }
    
    if (eventType === "rendition_changed") {
      const rendition =
        payload?.rendition_name ||
        payload?.rendition ||
        payload?.renditionId ||
        payload?.variant ||
        payload?.id;
      const reason = payload?.reason || payload?.message;
      this.eventCb?.({
        type: "rendition-changed",
        rendition,
        auto: payload?.auto ?? msg.auto,
        reason,
        payload
      });
      return;
    }
    
    const rendition =
      payload?.rendition ||
      payload?.rendition_id ||
      payload?.renditionId ||
      payload?.variant ||
      payload?.id;
    const reason = payload?.reason || payload?.message;
    this.eventCb?.({
      type: "notification",
      event: eventType,
      rendition,
      reason,
      payload
    });
  }
  
  changeRendition(renditionName?: string, auto?: boolean): void {
    if (!this.ws || this.ws.readyState !== 1) return;
    if (!this.connectionId) return;
    const message: any = {
      command: "change_rendition",
      id: this.connectionId
    };
    if (renditionName) message.rendition_name = renditionName;
    if (typeof auto === 'boolean') message.auto = auto;
    this.send(message);
  }

  private handleOffer(msg: OvenMessage): void {
    // Extract connection identifiers from offer
    this.connectionId = msg.id || null;
    this.peerId = msg.peer_id || null;
    console.log('[oven] Connection ID:', this.connectionId, 'Peer ID:', this.peerId);
    
    // Extract ICE servers from offer (OME can send these)
    const rawIceServers = msg.iceServers || msg.ice_servers;
    let iceServers: RTCIceServer[] | undefined;
    if (rawIceServers && Array.isArray(rawIceServers) && rawIceServers.length > 0) {
      iceServers = rawIceServers.map(server => ({
        urls: server.urls,
        username: server.username || server.user_name,
        credential: server.credential
      })).filter(server => server.urls);
      console.log('[oven] Received ICE servers:', iceServers.length);
      this.connectionConfigPolicy = 'relay';
    }
    
    // Parse SDP - OME can send as string or object { sdp, type }
    let sdpStr: string;
    if (typeof msg.sdp === 'string') {
      sdpStr = msg.sdp;
    } else if (msg.sdp && typeof msg.sdp === 'object') {
      sdpStr = msg.sdp.sdp;
    } else {
      console.error('[oven] Invalid SDP format in offer');
      return;
    }
    
    console.log('[oven] Received offer SDP, length:', sdpStr.length);
    this.eventCb?.({ type: "offer", sdp: sdpStr, iceServers });
    this.onOffer?.(sdpStr, iceServers);
    this.resolveReady?.();
    this.resolveReady = undefined;
    
    // OME may also send ICE candidates with the offer
    if (msg.candidates && Array.isArray(msg.candidates)) {
      console.log('[oven] Received', msg.candidates.length, 'ICE candidates with offer');
      for (const cand of msg.candidates) {
        if (cand.candidate) {
          this.eventCb?.({ type: "remote-candidate", candidate: cand });
          this.onCandidate?.(cand);
        }
      }
    }
  }


  private handleCandidate(msg: OvenMessage): void {
    // OME sends candidates in 'candidates' array or single 'candidate' field
    if (msg.candidates && Array.isArray(msg.candidates)) {
      for (const cand of msg.candidates) {
        if (cand.candidate) {
          console.log('[oven] Received ICE candidate:', cand.candidate.substring(0, 50) + '...');
          this.eventCb?.({ type: "remote-candidate", candidate: cand });
          // Pass the full candidate object to preserve sdpMid and sdpMLineIndex
          this.onCandidate?.(cand);
        }
      }
    } else if (msg.candidate) {
      // Single candidate format - OME may not provide sdpMid/sdpMLineIndex
      // Let RTCIceCandidate parse from the candidate string
      const candObj = { candidate: msg.candidate };
      console.log('[oven] Received single ICE candidate');
      this.eventCb?.({ type: "remote-candidate", candidate: candObj });
      this.onCandidate?.(candObj as any);
    }
  }

  async waitOffer(timeoutMs = 10000): Promise<void> {
    if (!this.ws) throw new Error("ws not connected");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.resolveReady = undefined;
        reject(new Error("offer timeout"));
      }, timeoutMs);
      this.resolveReady = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  onRemoteOffer(cb: (sdp: string, iceServers?: RTCIceServer[]) => void): void {
    this.onOffer = cb;
  }

  onRemoteCandidate(cb: (cand: { candidate: string; sdpMid?: string; sdpMLineIndex?: number }) => void): void {
    this.onCandidate = cb;
  }

  /**
   * Send answer SDP to OME.
   * Uses connectionId and peerId from the offer message.
   */
  sendAnswer(answer: RTCSessionDescriptionInit): void {
    console.log('[oven] Sending answer SDP, length:', answer.sdp?.length);
    this.eventCb?.({ type: "answer-send" });
    this.answerAcknowledged = false;
    
    // OME expects the full answer object with connection identifiers
    this.send({ 
      command: "answer",
      id: this.connectionId,
      peer_id: this.peerId,
      sdp: answer  // Send full RTCSessionDescriptionInit object
    });
  }

  /**
   * Send local ICE candidate to OME.
   */
  sendCandidate(candidate: RTCIceCandidate): void {
    console.log('[oven] Sending local ICE candidate');
    this.eventCb?.({ type: "candidate-send", candidate: candidate.candidate });
    
    // OME expects candidates array with connection identifiers
    this.send({ 
      command: "candidate",
      id: this.connectionId,
      peer_id: this.peerId,
      candidates: [candidate]
    });
  }

  isAnswerAcknowledged(): boolean {
    return this.answerAcknowledged;
  }

  getConnectionId(): string | null {
    return this.connectionId;
  }

  getPeerId(): string | null {
    return this.peerId;
  }

  private send(msg: any): void {
    // Use numeric value 1 for OPEN state (more reliable across environments)
    if (!this.ws || this.ws.readyState !== 1) {
      console.warn('[oven] Cannot send, WebSocket not open');
      return;
    }
    console.log('[oven] Sending:', msg.command);
    this.ws.send(JSON.stringify(msg));
  }

  async destroy(): Promise<void> {
    // Send stop command before closing (if connected)
    // Use numeric value 1 for OPEN state
    if (this.ws && this.ws.readyState === 1 && this.connectionId) {
      console.log('[oven] Sending stop command');
      this.send({
        command: "stop",
        id: this.connectionId,
        peer_id: this.peerId
      });
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.connectionId = null;
    this.peerId = null;
  }
}
