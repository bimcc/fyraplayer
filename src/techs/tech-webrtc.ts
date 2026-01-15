import { AbstractTech } from "./abstractTech.js";
import { BufferPolicy, MetricsOptions, ReconnectPolicy, Source, WebRTCSignalConfig, DataChannelOptions } from "../types.js";
import { createSignalAdapter, WebRTCSignalAdapter } from "./webrtc/signalAdapter.js";

/**
 * WebRTC Tech implementation.
 * Based on OvenPlayer architecture: WebRTCProvider/Signaling, DataChannel (SEI/heartbeat), ICE reconnection.
 */
export class WebRTCTech extends AbstractTech {
  private pc: RTCPeerConnection | null = null;
  private adapter: WebRTCSignalAdapter | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private dataChannelOpts: DataChannelOptions | undefined;
  private dataHeartbeat: any = null;
  private connectTimer: any = null;
  private lastStatsTs = 0;
  private lastBytes = 0;
  private lastFrames = 0;
  private readyFired = false;
  private lastStatsSnapshot: any = null;
  private iceReconnectTimer: any = null;
  private playoutDelayHintSeconds: number | null = null;
  private lastLoadOpts:
    | {
        buffer?: BufferPolicy;
        reconnect?: ReconnectPolicy;
        metrics?: MetricsOptions;
        video: HTMLVideoElement;
        webCodecs?: import("../types.js").WebCodecsConfig;
        dataChannel?: DataChannelOptions;
      }
    | null = null;
  private abrSwitching = false;
  private currentRendition: string | null = null;
  private omePlaylist: Array<any> | null = null;
  private omeAutoQuality = true;
  private packetLossWindow: number[] = [];
  private packetLossPrevLost: number | null = null;
  private packetLossTimer: any = null;
  private lastAbrDownswitchTs = 0;
  private audioCtx: AudioContext | null = null;

  canPlay(source: Source): boolean {
    return source.type === "webrtc";
  }

  async load(
    source: Source,
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
      webCodecs?: import("../types.js").WebCodecsConfig;
      dataChannel?: DataChannelOptions;
    }
  ): Promise<void> {
    this.source = source;
    this.buffer = opts.buffer;
    this.reconnect = opts.reconnect;
    this.metrics = opts.metrics;
    this.video = opts.video;
    this.dataChannelOpts = opts.dataChannel;
    this.lastLoadOpts = opts;
    this.readyFired = false;
    this.currentRendition = null;
    this.omePlaylist = null;
    this.omeAutoQuality = true;
    this.packetLossWindow = [];
    this.packetLossPrevLost = null;
    this.lastAbrDownswitchTs = 0;
    this.audioCtx = null;
    this.playoutDelayHintSeconds = this.computePlayoutDelayHintSeconds();
    
    // Configure video element for low-latency WebRTC playback
    this.video.playsInline = true;
    this.video.autoplay = true;
    // Disable default buffering for real-time playback
    if ('disableRemotePlayback' in this.video) {
      (this.video as any).disableRemotePlayback = true;
    }
    
    // Requirements 2.5: Metadata load timeout warning
    const metadataTimeout = this.reconnect?.timeoutMs ?? 10000;
    let metadataTimer: any = null;
    
    this.video.onloadedmetadata = () => {
      if (metadataTimer) {
        clearTimeout(metadataTimer);
        metadataTimer = null;
      }
    };
    
    this.video.onloadeddata = () => {
      if (metadataTimer) {
        clearTimeout(metadataTimer);
        metadataTimer = null;
      }
      this.bus.emit("ready");
    };
    
    this.video.onerror = (e) => {
      this.bus.emit("error", e);
      this.bus.emit("network", { type: "video-error" });
    };
    
    if (!source.url) {
      this.bus.emit("error", new Error("WebRTC signaling URL required"));
      return;
    }
    const webrtcSource = source as Extract<Source, { type: "webrtc" }>;
    const pcCfg: RTCConfiguration = { iceServers: webrtcSource.iceServers };
    if (webrtcSource.forceRelay || /[\?&]transport=tcp/i.test(webrtcSource.url)) {
      pcCfg.iceTransportPolicy = 'relay';
    }
    this.pc = new RTCPeerConnection(pcCfg);
    // Pre-create recvonly transceivers to match OME/Oven defaults and avoid implicit renegotiation
    const videoTransceiver = this.pc.addTransceiver('video', { direction: 'recvonly' });
    const audioTransceiver = this.pc.addTransceiver('audio', { direction: 'recvonly' });
    this.applyPlayoutDelayHint(videoTransceiver.receiver);
    this.applyPlayoutDelayHint(audioTransceiver.receiver);
    this.applyPlayoutDelayHintToReceivers();
    this.bindTracks();
    this.setupDataChannel(this.dataChannelOpts);
    try {
      await this.negotiate(webrtcSource.signal, webrtcSource);
    } catch (err) {
      this.bus.emit("network", { type: "signal-error", fatal: true, error: err });
      throw err;
    }
    this.startConnectTimeout();
    this.startPacketLossMonitor();
    
    // Requirements 2.5: Start metadata timeout after negotiation
    metadataTimer = setTimeout(() => {
      if (!this.video?.videoWidth) {
        console.warn('[webrtc] Video metadata not loaded within timeout, continuing...');
        this.bus.emit("network", { type: "metadata-timeout", warning: true });
      }
    }, metadataTimeout);
  }

  override async destroy(): Promise<void> {
    this.stopPacketLossMonitor();
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {
        /* ignore */
      }
      this.audioCtx = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.iceReconnectTimer) {
      clearTimeout(this.iceReconnectTimer);
      this.iceReconnectTimer = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.teardownDataChannel();
    await this.adapter?.destroy();
    this.adapter = null;
    this.lastLoadOpts = null;
    this.abrSwitching = false;
    this.currentRendition = null;
    this.omePlaylist = null;
    this.omeAutoQuality = true;
    this.packetLossWindow = [];
    this.packetLossPrevLost = null;
    this.lastAbrDownswitchTs = 0;
    this.playoutDelayHintSeconds = null;
  }

  override getStats() {
    const base = super.getStats();
    if (!this.pc) return base;
    // 异步刷新缓存，避免返回 Promise
    this.computeRtcStats()
      .then((s) => (this.lastStatsSnapshot = s))
      .catch(() => {});
    return this.lastStatsSnapshot || base;
  }

  private computePlayoutDelayHintSeconds(): number | null {
    // Only use explicit hint to avoid inflating latency by default
    if (typeof this.buffer?.playoutDelayHintMs === 'number') {
      const ms = Math.max(0, this.buffer.playoutDelayHintMs);
      if (ms === 0) return null;
      return ms / 1000;
    }
    return null;
  }

  private applyPlayoutDelayHint(receiver?: RTCRtpReceiver | null): void {
    const hint = this.playoutDelayHintSeconds;
    if (!receiver || hint === null) return;
    try {
      if ('playoutDelayHint' in receiver) {
        (receiver as any).playoutDelayHint = hint;
      }
      // Audio receivers can also take jitterBufferDelayHint in some browsers
      if (receiver.track?.kind === 'audio' && 'jitterBufferDelayHint' in receiver) {
        (receiver as any).jitterBufferDelayHint = hint;
      }
    } catch (e) {
      console.warn('[webrtc] Failed to set playoutDelayHint', e);
    }
  }

  private applyPlayoutDelayHintToReceivers(): void {
    if (!this.pc) return;
    if (this.playoutDelayHintSeconds === null) return;
    try {
      this.pc.getReceivers().forEach((receiver) => this.applyPlayoutDelayHint(receiver));
    } catch (e) {
      console.warn('[webrtc] Unable to apply playoutDelayHint to receivers', e);
    }
  }

  private bindTracks(): void {
    if (!this.pc) return;
    this.applyPlayoutDelayHintToReceivers();
    
    // Simplified track handling for WebRTC
    // OvenPlayer uses evt.streams[0] directly
    let playAttempted = false;
    
    this.pc.ontrack = (evt) => {
      console.log('[webrtc] ontrack:', evt.track.kind);
      this.applyPlayoutDelayHint(evt.receiver);
      this.applyPlayoutDelayHint(evt.transceiver?.receiver);
      
      // Use the stream from the event directly (standard WebRTC behavior)
      const stream = evt.streams[0];
      if (!stream) {
        console.warn('[webrtc] No stream in track event');
        return;
      }
      
      if (this.video) {
        // Set srcObject if not already set or if it's a different stream
        if (this.video.srcObject !== stream) {
          console.log('[webrtc] Setting video srcObject');
          this.video.srcObject = stream;
        }
        this.applyPlayoutDelayHintToReceivers();
        this.ensureAudioContext(stream);
        
        // Attempt autoplay (only once)
        if (!playAttempted) {
          playAttempted = true;
          this.video.muted = true;
          this.video.play().catch((err) => {
            if (err.name === 'AbortError') {
              console.log('[webrtc] Play interrupted, will retry on user interaction');
            } else {
              console.warn('[webrtc] Autoplay blocked:', err);
            }
            this.bus.emit('network', { type: 'autoplay-blocked', error: err, severity: 'warning' });
          });
        }
      }
    };
    
    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      if (this.pc.connectionState === "connected") {
        this.readyFired = true;
        this.clearConnectTimeout();
        this.clearIceReconnectTimer();
        this.bus.emit("ready");
      }
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "disconnected") {
        this.bus.emit("network", { type: "disconnect", state: this.pc.connectionState, fatal: this.pc.connectionState === "failed" });
      }
    };
    
    this.pc.oniceconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;
      // Requirements 7.1: Emit ICE state events
      this.bus.emit("network", { type: "ice-state", state });
      if (state === "failed") {
        // Requirements 7.2: Emit fatal event on ICE failure
        this.bus.emit("network", { type: "ice-failed", fatal: true });
        this.clearIceReconnectTimer();
        if (this.pc.restartIce) {
          try {
            this.pc.restartIce();
          } catch (e) {
            console.warn("[webrtc] restartIce failed", e);
          }
        }
      } else if (state === "connected" || state === "completed") {
        this.clearConnectTimeout();
        this.clearIceReconnectTimer();
      } else if (state === "disconnected") {
        this.startIceReconnectTimer("ice-disconnected");
      }
    };
  }

  private async negotiate(signal: WebRTCSignalConfig | undefined, src: Extract<Source, { type: "webrtc" }>): Promise<void> {
    if (!this.pc) throw new Error("pc not ready");
    
    // Auto-detect signal config from URL if not provided
    let effectiveSignal = signal;
    if (!effectiveSignal && src.url) {
      effectiveSignal = this.inferSignalConfig(src.url);
    }
    
    if (!effectiveSignal) throw new Error("WebRTC signal config required");
    this.adapter = createSignalAdapter(effectiveSignal);
    await this.adapter.setup(this.pc, src, (evt) => {
      this.bus.emit("network", { type: "webrtc-signal", ...evt });
      if (evt?.type === "offer") {
        // signaling 已经收到 offer，视为 ready 进入缓冲状态
        this.bus.emit("buffer");
      }
      this.handleSignalSideEvents(evt);
    });
  }

  /**
   * Infer signal config from URL.
   * - ws:// or wss:// URLs are treated as OvenMediaEngine WebSocket signaling
   * - http:// or https:// URLs are treated as WHEP endpoints
   */
  private inferSignalConfig(url: string): WebRTCSignalConfig {
    if (url.startsWith('ws://') || url.startsWith('wss://')) {
      // OvenMediaEngine WebSocket signaling
      // Extract streamId from URL path (last segment) for logging purposes
      try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.split('/').filter(Boolean);
        const streamId = pathParts[pathParts.length - 1] || 'stream';
        console.log('[webrtc] Auto-detected OME WebSocket signaling, streamId:', streamId);
        return {
          type: 'oven-ws',
          url: url,  // Full URL including query params
          streamId
        };
      } catch {
        return { type: 'oven-ws', url, streamId: 'stream' };
      }
    }
    // Default to WHEP for HTTP(S) URLs
    console.log('[webrtc] Auto-detected WHEP signaling');
    return { type: 'whep', url };
  }

  private setupDataChannel(opts?: DataChannelOptions): void {
    if (!opts?.enable) return;
    if (!this.pc) return;
    this.dataChannel = this.pc.createDataChannel(opts.label ?? "data");
    this.dataChannel.onmessage = (evt) => this.bus.emit("data", evt.data);
    this.dataChannel.onopen = () => this.startDataHeartbeat(opts);
    this.dataChannel.onclose = () => this.stopDataHeartbeat();
  }

  private startDataHeartbeat(opts: DataChannelOptions): void {
    this.stopDataHeartbeat();
    const interval = opts.heartbeatMs ?? 5000;
    this.dataHeartbeat = setInterval(() => {
      if (this.dataChannel?.readyState === "open") {
        this.dataChannel.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      }
    }, interval);
  }

  private stopDataHeartbeat(): void {
    if (this.dataHeartbeat) clearInterval(this.dataHeartbeat);
    this.dataHeartbeat = null;
  }

  private teardownDataChannel(): void {
    this.stopDataHeartbeat();
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {
        /* ignore */
      }
      this.dataChannel = null;
    }
  }

  private startConnectTimeout(): void {
    const timeout = this.reconnect?.timeoutMs ?? 15000;
    this.clearConnectTimeout();
    this.connectTimer = setTimeout(() => {
      if (this.readyFired) return;
      this.bus.emit("network", { type: "connect-timeout", timeoutMs: timeout });
      this.bus.emit("error", new Error("WebRTC connect timeout"));
    }, timeout);
  }

  private clearConnectTimeout(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearIceReconnectTimer(): void {
    if (this.iceReconnectTimer) {
      clearTimeout(this.iceReconnectTimer);
      this.iceReconnectTimer = null;
    }
  }
  
  private handleSignalSideEvents(evt: any): void {
    if (!evt) return;
    if (evt.type === "notification") {
      this.bus.emit("network", { type: "webrtc-notification", event: evt.event, reason: evt.reason, rendition: evt.rendition });
    }
    if (evt.type === "playlist") {
      const playlist = Array.isArray(evt.playlist) ? evt.playlist : [];
      this.omePlaylist = playlist.slice().sort((a: any, b: any) => {
        const aBitrate = a?.video_track?.video?.bitrate ?? a?.audio_track?.bitrate ?? 0;
        const bBitrate = b?.video_track?.video?.bitrate ?? b?.audio_track?.bitrate ?? 0;
        return bBitrate - aBitrate;
      });
      this.omeAutoQuality = evt.auto !== false;
      if (!this.currentRendition && this.omePlaylist && this.omePlaylist.length > 0) {
        const top = this.omePlaylist[0];
        this.currentRendition = top?.name ?? top?.rendition_name ?? null;
      }
      this.bus.emit("network", { type: "webrtc-playlist", renditionCount: this.omePlaylist?.length ?? 0, auto: this.omeAutoQuality });
    }
    if (evt.type === "rendition-changed") {
      const prev = this.currentRendition;
      this.currentRendition = evt.rendition ?? this.currentRendition;
      if (typeof evt.auto === 'boolean') this.omeAutoQuality = evt.auto;
      this.bus.emit("levelSwitch", { from: prev, to: this.currentRendition, auto: this.omeAutoQuality });
      this.bus.emit("network", { type: "abr-rendition", rendition: this.currentRendition, auto: this.omeAutoQuality });
    }
    if (evt.type === "abr-rendition") {
      this.handleAbrRenditionChange(evt).catch((err) => {
        console.warn('[webrtc] abr switch failed', err);
        this.bus.emit("network", { type: "abr-fallback-error", error: err });
      });
    }
  }
  
  private pickLowerRenditionSource(): Source | null {
    const srcWithFallbacks = this.source as Source & { fallbacks?: Source[] };
    if (!srcWithFallbacks?.fallbacks || !Array.isArray(srcWithFallbacks.fallbacks)) return null;
    // Assume fallbacks are ordered from high -> low bitrate
    const next = srcWithFallbacks.fallbacks.find((s) => s.type === 'webrtc') ?? srcWithFallbacks.fallbacks[0];
    if (!next || next === this.source) return null;
    return next ?? null;
  }
  
  private async resetPeerConnection(): Promise<void> {
    this.stopPacketLossMonitor();
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {
        /* ignore */
      }
      this.audioCtx = null;
    }
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.iceReconnectTimer) {
      clearTimeout(this.iceReconnectTimer);
      this.iceReconnectTimer = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.teardownDataChannel();
    await this.adapter?.destroy();
    this.adapter = null;
    this.readyFired = false;
  }
  
  private async handleAbrRenditionChange(evt: any): Promise<void> {
    if (this.abrSwitching) return;
    const rendition = evt?.rendition ?? evt?.payload?.rendition ?? null;
    const reason = evt?.reason;
    this.bus.emit("network", { type: "abr-rendition", rendition, reason, severity: "warning" });
    this.bus.emit("levelSwitch", { from: this.currentRendition, to: rendition, auto: true });
    
    // Prefer in-place rendition switch via signaling when playlist is known
    const switched = this.requestLowerRendition(rendition);
    if (switched) return;
    
    const next = this.pickLowerRenditionSource();
    if (!next || !this.lastLoadOpts) return;
    
    this.abrSwitching = true;
    try {
      await this.resetPeerConnection();
      await this.load(next, this.lastLoadOpts);
      this.currentRendition = rendition ?? 'abr-fallback';
    } finally {
      this.abrSwitching = false;
    }
  }

  private startIceReconnectTimer(reason: string): void {
    if (!this.pc || typeof this.pc.restartIce !== 'function') return;
    const delay = Math.min(3000, Math.max(800, this.reconnect?.baseDelayMs ?? 1500));
    this.clearIceReconnectTimer();
    this.iceReconnectTimer = setTimeout(() => {
      this.iceReconnectTimer = null;
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') return;
      try {
        this.pc.restartIce();
        this.bus.emit("network", { type: "ice-restart", reason });
      } catch (e) {
        console.warn("[webrtc] restartIce failed", e);
        this.bus.emit("network", { type: "ice-restart-failed", error: e });
      }
    }, delay);
  }
  
  private startPacketLossMonitor(): void {
    this.stopPacketLossMonitor();
    const interval = 2000;
    this.packetLossTimer = setInterval(() => this.checkPacketLossAndAbr(), interval);
  }
  
  private stopPacketLossMonitor(): void {
    if (this.packetLossTimer) {
      clearInterval(this.packetLossTimer);
      this.packetLossTimer = null;
    }
  }
  
  private async checkPacketLossAndAbr(): Promise<void> {
    if (!this.pc) return;
    const report = await this.pc.getStats().catch(() => null);
    if (!report) return;
    let packetsLost: number | null = null;
    report.forEach((s: any) => {
      if (s.type === "inbound-rtp" && s.kind === "video" && !s.isRemote) {
        packetsLost = typeof s.packetsLost === 'number' ? s.packetsLost : packetsLost;
      }
    });
    if (packetsLost === null) return;
    if (this.packetLossPrevLost === null) {
      this.packetLossPrevLost = packetsLost;
      return;
    }
    const delta = Math.max(0, packetsLost - this.packetLossPrevLost);
    this.packetLossPrevLost = packetsLost;
    this.packetLossWindow.push(delta);
    const windowSize = 8;
    if (this.packetLossWindow.length > windowSize) this.packetLossWindow.shift();
    if (this.packetLossWindow.length === windowSize) {
      const avg = this.packetLossWindow.reduce((a, b) => a + b, 0) / windowSize;
      const threshold = 40;
      if (avg > threshold) {
        const now = Date.now();
        if (now - this.lastAbrDownswitchTs > 8000) {
          this.lastAbrDownswitchTs = now;
          const switched = this.requestLowerRendition(null);
          if (!switched) {
            this.handleAbrRenditionChange({ reason: 'packet-loss', rendition: null }).catch(() => {});
          }
        }
      }
    }
  }
  
  private requestLowerRendition(target?: string | null): boolean {
    if (!this.adapter?.changeRendition) return false;
    if (!this.omePlaylist || this.omePlaylist.length === 0) return false;
    if (this.omeAutoQuality === false) return false;
    
    // Determine current index in playlist
    const currentIndex = this.currentRendition
      ? this.omePlaylist.findIndex((r: any) => r?.name === this.currentRendition || r?.rendition_name === this.currentRendition)
      : 0;
    const nextIndex = currentIndex >= 0 && currentIndex < this.omePlaylist.length - 1 ? currentIndex + 1 : this.omePlaylist.length - 1;
    if (nextIndex === currentIndex) return false;
    const next = this.omePlaylist[nextIndex];
    const name = target ?? next?.name ?? next?.rendition_name;
    if (!name) return false;
    const prev = this.currentRendition;
    this.adapter.changeRendition(name, true);
    this.currentRendition = name;
    this.bus.emit("network", { type: "abr-change_rendition", rendition: name, auto: true });
    this.bus.emit("levelSwitch", { from: prev, to: name, auto: true });
    return true;
  }
  
  private ensureAudioContext(stream: MediaStream): void {
    // Safari/Chrome workaround: keep audio pipeline alive to avoid A/V drift
    if (this.audioCtx) return;
    if (!stream.getAudioTracks().length) return;
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.audioCtx = new AudioCtx();
      const source = this.audioCtx!.createMediaStreamSource(stream);
      // Connect to destination to keep context running; volume unaffected
      source.connect(this.audioCtx!.destination);
    } catch (e) {
      console.warn('[webrtc] audio context init failed', e);
    }
  }

  private async computeRtcStats() {
    if (!this.pc) return super.getStats();
    const report = await this.pc.getStats();
    let bytes = 0;
    let frames = 0;
    let framesDecoded: number | undefined;
    let framesDropped: number | undefined;
    let framesReceived: number | undefined;
    let pliCount: number | undefined;
    let nackCount: number | undefined;
    let firCount: number | undefined;
    let jitterBufferMs: number | undefined;
    let decodeMs: number | undefined;
    let width: number | undefined;
    let height: number | undefined;
    let candidatePairId: string | undefined;
    const localCandidates = new Map<string, any>();
    const remoteCandidates = new Map<string, any>();
    let jitterMs: number | undefined;
    let rttMs: number | undefined;
    let bitrateKbps: number | undefined;
    let fps: number | undefined;
    let packetsLost: number | undefined;
    let packetsRecv: number | undefined;
    let candidateType: string | undefined;
    let transport: string | undefined;
    report.forEach((s) => {
      if ((s as any).type === "inbound-rtp" && (s as any).kind === "video") {
        bytes += (s as any).bytesReceived || 0;
        frames += (s as any).framesDecoded || 0;
        framesDecoded = (s as any).framesDecoded;
        framesDropped = (s as any).framesDropped;
        framesReceived = (s as any).packetsReceived;
        pliCount = (s as any).pliCount;
        nackCount = (s as any).nackCount;
        firCount = (s as any).firCount;
        if ((s as any).jitterBufferDelay !== undefined && (s as any).jitterBufferEmittedCount) {
          const avg = (s as any).jitterBufferDelay / (s as any).jitterBufferEmittedCount;
          jitterBufferMs = Math.round(avg * 1000);
        }
        if ((s as any).totalDecodeTime !== undefined && (s as any).framesDecoded) {
          decodeMs = Math.round(((s as any).totalDecodeTime / (s as any).framesDecoded) * 1000);
        }
        packetsLost = (s as any).packetsLost;
        packetsRecv = (s as any).packetsReceived;
      }
      if ((s as any).type === "candidate-pair" && (s as any).state === "succeeded") {
        rttMs = Math.round(((s as any).currentRoundTripTime || 0) * 1000);
        candidatePairId = (s as any).id;
      }
      if ((s as any).type === "inbound-rtp" && (s as any).kind === "audio") {
        if ((s as any).jitter !== undefined) {
          jitterMs = Math.round(((s as any).jitter || 0) * 1000);
        }
      }
      if ((s as any).type === "track" && (s as any).kind === "video") {
        width = (s as any).frameWidth ?? width;
        height = (s as any).frameHeight ?? height;
      }
      if ((s as any).type === "local-candidate") {
        localCandidates.set((s as any).id, s);
      }
      if ((s as any).type === "remote-candidate") {
        remoteCandidates.set((s as any).id, s);
      }
    });
    // Resolve selected candidate info
    if (candidatePairId) {
      const pair = Array.from(report.values()).find((s: any) => s.id === candidatePairId) as any;
      const local = pair?.localCandidateId ? localCandidates.get(pair.localCandidateId) : null;
      const remote = pair?.remoteCandidateId ? remoteCandidates.get(pair.remoteCandidateId) : null;
      candidateType = remote?.candidateType || local?.candidateType;
      transport = local?.protocol || remote?.protocol;
    }
    const now = Date.now();
    if (this.lastStatsTs > 0) {
      const dt = Math.max(1, now - this.lastStatsTs);
      const dBytes = Math.max(0, bytes - this.lastBytes);
      const dFrames = Math.max(0, frames - this.lastFrames);
      bitrateKbps = Math.round((dBytes * 8) / (dt / 1000) / 1000);
      fps = Math.round(dFrames / (dt / 1000));
    }
    this.lastStatsTs = now;
    this.lastBytes = bytes;
    this.lastFrames = frames;
    return {
      ts: now,
      bitrateKbps,
      fps,
      jitterMs,
      rttMs,
      jitterBufferMs,
      decodeMs,
      packetLoss: packetsLost,
      packetsRecv,
      framesDecoded,
      framesDropped,
      framesReceived,
      pliCount,
      nackCount,
      firCount,
      width,
      height,
      candidateType,
      transport
    };
  }
}
