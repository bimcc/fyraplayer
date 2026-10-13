import { AbstractTech } from "./abstractTech.js";
import { Source, TechLoadOptions, WebRTCSignalConfig, DataChannelOptions, EngineStats } from "../types.js";
import { createSignalAdapter, WebRTCSignalAdapter } from "./webrtc/signalAdapter.js";
import { abortReason, throwIfAborted } from '../core/abort.js';

type VideoElementWithPlaybackHints = HTMLVideoElement & {
  disableRemotePlayback?: boolean;
};

type ReceiverWithDelayHints = RTCRtpReceiver & {
  playoutDelayHint?: number;
  jitterBufferDelayHint?: number;
};

type RenditionInfo = {
  name?: string;
  rendition_name?: string;
  video_track?: { video?: { bitrate?: number } };
  audio_track?: { bitrate?: number };
};

type SignalSideEvent = {
  type?: string;
  event?: string;
  reason?: string;
  rendition?: string | null;
  playlist?: RenditionInfo[];
  auto?: boolean;
  payload?: { rendition?: string | null };
};

type CandidatePairStats = RTCStats & {
  type: 'candidate-pair';
  state?: string;
  currentRoundTripTime?: number;
  localCandidateId?: string;
  remoteCandidateId?: string;
};

type InboundRtpStats = RTCStats & {
  type: 'inbound-rtp';
  kind?: 'audio' | 'video';
  isRemote?: boolean;
  bytesReceived?: number;
  framesDecoded?: number;
  framesDropped?: number;
  packetsReceived?: number;
  packetsLost?: number;
  pliCount?: number;
  nackCount?: number;
  firCount?: number;
  jitterBufferDelay?: number;
  jitterBufferEmittedCount?: number;
  totalDecodeTime?: number;
  jitter?: number;
};

type TrackStats = Omit<RTCStats, 'type'> & {
  type: 'track';
  kind?: 'audio' | 'video';
  frameWidth?: number;
  frameHeight?: number;
};

type IceCandidateStats = RTCStats & {
  candidateType?: string;
  protocol?: string;
};

/**
 * WebRTC Tech implementation.
 * Based on OvenPlayer architecture: WebRTCProvider/Signaling, DataChannel (SEI/heartbeat), ICE reconnection.
 */
export class WebRTCTech extends AbstractTech {
  private pc: RTCPeerConnection | null = null;
  private adapter: WebRTCSignalAdapter | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private dataChannelOpts: DataChannelOptions | undefined;
  private dataHeartbeat: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private metadataTimer: ReturnType<typeof setTimeout> | null = null;
  private loadController: AbortController | null = null;
  private generation = 0;
  private lastStatsTs = 0;
  private lastBytes = 0;
  private lastFrames = 0;
  private readyFired = false;
  private lastStatsSnapshot: EngineStats | null = null;
  private iceReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private playoutDelayHintSeconds: number | null = null;
  private lastLoadOpts: TechLoadOptions | null = null;
  private abrSwitching = false;
  private currentRendition: string | null = null;
  private omePlaylist: RenditionInfo[] | null = null;
  private omeAutoQuality = true;
  private packetLossWindow: number[] = [];
  private packetLossPrevLost: number | null = null;
  private packetLossTimer: ReturnType<typeof setInterval> | null = null;
  private lastAbrDownswitchTs = 0;
  private audioMuteTimers: Set<ReturnType<typeof setTimeout>> = new Set();

  canPlay(source: Source): boolean {
    return source.type === "webrtc";
  }

  async load(
    source: Source,
    opts: TechLoadOptions
  ): Promise<void> {
    throwIfAborted(opts.signal);
    if (source.type !== 'webrtc' || !source.url) throw new Error('WebRTC signaling URL required');
    const reset = this.resetPeerConnection();
    const generation = this.generation;
    await reset;
    throwIfAborted(opts.signal);
    if (generation !== this.generation) throw new DOMException('Stale WebRTC load', 'AbortError');
    this.source = source;
    this.buffer = opts.buffer;
    this.reconnect = opts.reconnect;
    this.metrics = opts.metrics;
    this.video = opts.video;
    this.dataChannelOpts = opts.dataChannel;
    // A completed load signal must not be reused by later internal rendition switches.
    this.lastLoadOpts = { ...opts, signal: undefined };
    this.readyFired = false;
    this.currentRendition = null;
    this.omePlaylist = null;
    this.omeAutoQuality = true;
    this.packetLossWindow = [];
    this.packetLossPrevLost = null;
    this.lastAbrDownswitchTs = 0;
    this.playoutDelayHintSeconds = this.computePlayoutDelayHintSeconds();
    
    // Configure video element for low-latency WebRTC playback
    // Inline playback is configured by the owning Player/application.
    this.video.autoplay = true;
    // Disable default buffering for real-time playback
    if ('disableRemotePlayback' in this.video) {
      (this.video as VideoElementWithPlaybackHints).disableRemotePlayback = true;
    }
    
    // Requirements 2.5: Metadata load timeout warning
    const metadataTimeout = this.reconnect?.timeoutMs ?? 10000;
    const controller = new AbortController();
    this.loadController = controller;
    const active = () => generation === this.generation && !controller.signal.aborted;
    const cancel = () => {
      controller.abort(opts.signal && abortReason(opts.signal));
      if (generation === this.generation) void this.resetPeerConnection();
    };
    opts.signal?.addEventListener('abort', cancel, { once: true });
    if (opts.signal?.aborted) cancel();
    
    this.video.onloadedmetadata = () => {
      if (active()) this.clearMetadataTimer();
    };
    
    this.video.onloadeddata = () => {
      if (!active()) return;
      this.clearMetadataTimer();
      this.emitReadyOnce();
    };
    
    this.video.onerror = (e) => {
      if (!active()) return;
      this.bus.emit("error", e);
      this.bus.emit("network", { type: "video-error" });
    };
    
    try {
      throwIfAborted(controller.signal);
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
      await this.negotiate(webrtcSource.signal, webrtcSource, controller.signal, generation);
      throwIfAborted(controller.signal);
      if (!active()) throw new DOMException('Stale WebRTC load', 'AbortError');
      this.startConnectTimeout();
      this.startPacketLossMonitor();

      // Requirements 2.5: Start metadata timeout after negotiation
      this.metadataTimer = setTimeout(() => {
        this.metadataTimer = null;
        if (!active()) return;
        if (!this.video?.videoWidth) {
          console.warn('[webrtc] Video metadata not loaded within timeout, continuing...');
          this.bus.emit("network", { type: "metadata-timeout", warning: true });
        }
      }, metadataTimeout);
    } catch (err) {
      if (active()) this.bus.emit('network', { type: 'signal-error', fatal: true, error: err });
      if (generation === this.generation) await this.resetPeerConnection();
      throw err;
    } finally {
      opts.signal?.removeEventListener('abort', cancel);
    }
  }

  override async destroy(): Promise<void> {
    await this.resetPeerConnection();
    this.lastLoadOpts = null;
    this.abrSwitching = false;
    this.currentRendition = null;
    this.omePlaylist = null;
    this.omeAutoQuality = true;
    this.packetLossWindow = [];
    this.packetLossPrevLost = null;
    this.lastAbrDownswitchTs = 0;
    this.playoutDelayHintSeconds = null;
    this.resetPlaybackFpsSampler();
  }

  override getStats() {
    const base = super.getStats();
    if (!this.pc) return base;
    const generation = this.generation;
    // 异步刷新缓存，避免返回 Promise
    this.computeRtcStats()
      .then(s => { if (generation === this.generation) this.lastStatsSnapshot = s; })
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
      const receiverWithHints = receiver as ReceiverWithDelayHints;
      if ('playoutDelayHint' in receiver) {
        receiverWithHints.playoutDelayHint = hint;
      }
      // Audio receivers can also take jitterBufferDelayHint in some browsers
      if (receiver.track?.kind === 'audio' && 'jitterBufferDelayHint' in receiver) {
        receiverWithHints.jitterBufferDelayHint = hint;
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
    const pc = this.pc;
    const generation = this.generation;
    const active = () => this.pc === pc && this.generation === generation;
    this.applyPlayoutDelayHintToReceivers();
    
    // Simplified track handling for WebRTC
    // OvenPlayer uses evt.streams[0] directly
    let playAttempted = false;
    
    this.pc.ontrack = (evt) => {
      if (!active()) return;
      console.log('[webrtc] ontrack:', evt.track.kind);
      this.applyPlayoutDelayHint(evt.receiver);
      this.applyPlayoutDelayHint(evt.transceiver?.receiver);
      if (evt.track.kind === 'audio') {
        this.monitorAudioTrack(evt.track);
      }
      
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
        
        // Attempt autoplay (only once)
        if (!playAttempted) {
          playAttempted = true;
          this.video.play().catch((err) => {
            if (!active()) return;
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
      if (!active() || !this.pc) return;
      if (this.pc.connectionState === "connected") {
        this.clearConnectTimeout();
        this.clearIceReconnectTimer();
        this.emitReadyOnce();
      }
      if (this.pc.connectionState === "failed" || this.pc.connectionState === "disconnected") {
        this.bus.emit("network", { type: "disconnect", state: this.pc.connectionState, fatal: this.pc.connectionState === "failed" });
      }
    };
    
    this.pc.oniceconnectionstatechange = () => {
      if (!active() || !this.pc) return;
      const state = this.pc.iceConnectionState;
      // Requirements 7.1: Emit ICE state events
      this.bus.emit("network", { type: "ice-state", state });
      if (state === "failed") {
        // Requirements 7.2: Emit fatal event on ICE failure. Browser
        // restartIce() still needs renegotiation, so the player-level reload is
        // the reliable recovery path for WHEP/WHIP and most one-shot signaling.
        this.bus.emit("network", { type: "ice-failed", fatal: true });
        this.clearIceReconnectTimer();
      } else if (state === "connected" || state === "completed") {
        this.clearConnectTimeout();
        this.clearIceReconnectTimer();
      } else if (state === "disconnected") {
        this.startIceReconnectTimer("ice-disconnected");
      }
    };
  }

  private async negotiate(signal: WebRTCSignalConfig | undefined, src: Extract<Source, { type: "webrtc" }>, loadSignal: AbortSignal, generation: number): Promise<void> {
    if (!this.pc) throw new Error("pc not ready");
    
    // Auto-detect signal config from URL if not provided
    let effectiveSignal = signal;
    if (!effectiveSignal && src.url) {
      effectiveSignal = this.inferSignalConfig(src.url);
    }
    
    if (!effectiveSignal) throw new Error("WebRTC signal config required");
    this.applySourceIceConfig(src);
    if (effectiveSignal.type === 'whip' || effectiveSignal.type === 'whep') {
      effectiveSignal = {
        ...effectiveSignal,
        timeoutMs: effectiveSignal.timeoutMs ?? this.reconnect?.timeoutMs ?? 15000,
        iceGatheringTimeoutMs: effectiveSignal.iceGatheringTimeoutMs ?? 5000,
      };
    }
    this.adapter = createSignalAdapter(effectiveSignal);
    await this.adapter.setup(this.pc, src, (evt) => {
      if (loadSignal.aborted || generation !== this.generation) return;
      this.bus.emit("network", { ...evt, stage: "webrtc-signal" });
      if (evt?.type === "offer") {
        // signaling 已经收到 offer，视为 ready 进入缓冲状态
        this.bus.emit("buffer");
      }
      this.handleSignalSideEvents(evt);
    }, loadSignal);
  }

  private applySourceIceConfig(src: Extract<Source, { type: "webrtc" }>): void {
    if (!this.pc || !src.iceServers?.length) return;
    try {
      const config = this.pc.getConfiguration();
      this.pc.setConfiguration({
        ...config,
        iceServers: src.iceServers,
        iceTransportPolicy: src.forceRelay ? 'relay' : config.iceTransportPolicy
      });
      this.bus.emit("network", {
        type: "ice-config",
        serverCount: src.iceServers.length,
        forceRelay: !!src.forceRelay
      });
    } catch (error) {
      this.bus.emit("network", {
        type: "ice-config-error",
        severity: "warning",
        error
      });
    }
  }

  private emitReadyOnce(): void {
    if (this.readyFired) return;
    this.readyFired = true;
    this.bus.emit("ready");
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
    // Auto-detect MediaMTX style URLs and append /whep if missing
    let whepUrl = url;
    if (!url.endsWith('/whep') && !url.endsWith('/whip')) {
      try {
        const parsed = new URL(url);
        // MediaMTX default WebRTC port is 8889
        // Also check common patterns: no file extension, looks like a stream path
        const isLikelyMediaMTX = parsed.port === '8889' || 
          (!parsed.pathname.includes('.') && parsed.pathname !== '/');
        if (isLikelyMediaMTX) {
          whepUrl = url.endsWith('/') ? `${url}whep` : `${url}/whep`;
          console.log('[webrtc] Auto-appended /whep suffix for MediaMTX-style URL:', whepUrl);
        }
      } catch {
        // Invalid URL, use as-is
      }
    }
    console.log('[webrtc] Auto-detected WHEP signaling');
    return { type: 'whep', url: whepUrl };
  }

  private setupDataChannel(opts?: DataChannelOptions): void {
    if (!opts?.enable) return;
    if (!this.pc) return;
    this.dataChannel = this.pc.createDataChannel(opts.label ?? "data");
    const channel = this.dataChannel;
    const generation = this.generation;
    const active = () => this.dataChannel === channel && this.generation === generation;
    channel.onmessage = (evt) => { if (active()) this.bus.emit('data', evt.data); };
    channel.onopen = () => { if (active()) this.startDataHeartbeat(opts); };
    channel.onclose = () => { if (active()) this.stopDataHeartbeat(); };
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
      this.dataChannel.onmessage = this.dataChannel.onopen = this.dataChannel.onclose = null;
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
  
  private handleSignalSideEvents(evt: SignalSideEvent): void {
    if (!evt) return;
    if (evt.type === "notification") {
      this.bus.emit("network", { type: "webrtc-notification", event: evt.event, reason: evt.reason, rendition: evt.rendition });
    }
    if (evt.type === "playlist") {
      const playlist = Array.isArray(evt.playlist) ? evt.playlist : [];
      this.omePlaylist = playlist.slice().sort((a, b) => {
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
      const generation = this.generation;
      this.handleAbrRenditionChange(evt).catch((err) => {
        if (generation !== this.generation) return;
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
    this.generation += 1;
    this.loadController?.abort();
    this.loadController = null;
    this.clearMetadataTimer();
    this.lastStatsSnapshot = null;
    this.lastStatsTs = this.lastBytes = this.lastFrames = 0;
    this.resetPlaybackFpsSampler();
    this.clearAudioMuteTimers();
    this.stopPacketLossMonitor();
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.iceReconnectTimer) {
      clearTimeout(this.iceReconnectTimer);
      this.iceReconnectTimer = null;
    }
    if (this.pc) {
      this.pc.ontrack = null;
      this.pc.onicecandidate = null;
      this.pc.onconnectionstatechange = null;
      this.pc.oniceconnectionstatechange = null;
      this.pc.ondatachannel = null;
      this.pc.close();
      this.pc = null;
    }
    this.teardownDataChannel();
    const adapter = this.adapter;
    this.adapter = null;
    this.cleanupVideoElement();
    this.readyFired = false;
    await adapter?.destroy();
  }

  private clearMetadataTimer(): void {
    if (this.metadataTimer) clearTimeout(this.metadataTimer);
    this.metadataTimer = null;
  }

  private monitorAudioTrack(track: MediaStreamTrack): void {
    const timer = setTimeout(() => {
      this.audioMuteTimers.delete(timer);
      if (track.readyState !== 'live') return;
      if (!track.muted) return;
      this.bus.emit("network", {
        type: "webrtc-audio-muted",
        severity: "warning",
        message:
          "WebRTC audio track is present but muted by the browser; check source codec and server transcoding."
      });
    }, 3000);
    this.audioMuteTimers.add(timer);
  }

  private clearAudioMuteTimers(): void {
    for (const timer of this.audioMuteTimers) {
      clearTimeout(timer);
    }
    this.audioMuteTimers.clear();
  }

  private cleanupVideoElement(): void {
    if (!this.video) return;
    this.video.onloadedmetadata = null;
    this.video.onloadeddata = null;
    this.video.onerror = null;
    try {
      this.video.pause();
    } catch {
      /* ignore */
    }
    this.video.srcObject = null;
    try {
      this.video.removeAttribute('src');
      this.video.load();
    } catch {
      /* ignore */
    }
  }
  
  private async handleAbrRenditionChange(evt: SignalSideEvent): Promise<void> {
    if (this.abrSwitching) return;
    const generation = this.generation;
    const rendition = evt?.rendition ?? evt?.payload?.rendition ?? null;
    const reason = evt?.reason;
    this.bus.emit("network", { type: "abr-rendition", rendition, reason, severity: "warning" });
    this.bus.emit("levelSwitch", { from: this.currentRendition, to: rendition, auto: true });
    if (generation !== this.generation) return;
    
    // Prefer in-place rendition switch via signaling when playlist is known
    const switched = this.requestLowerRendition(rendition);
    if (switched) return;
    
    const next = this.pickLowerRenditionSource();
    if (!next || !this.lastLoadOpts) return;
    
    this.abrSwitching = true;
    const opts = this.lastLoadOpts;
    try {
      this.bus.emit('streamchange', { reason: 'fallback', source: next });
      if (generation !== this.generation) return;
      await this.load(next, opts);
      if (this.source !== next || !this.pc) return;
      this.currentRendition = rendition ?? 'abr-fallback';
    } finally {
      this.abrSwitching = false;
    }
  }

  private startIceReconnectTimer(reason: string): void {
    if (!this.pc) return;
    const delay = Math.min(3000, Math.max(800, this.reconnect?.baseDelayMs ?? 1500));
    this.clearIceReconnectTimer();
    this.iceReconnectTimer = setTimeout(() => {
      this.iceReconnectTimer = null;
      if (!this.pc) return;
      const state = this.pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') return;
      if (typeof this.pc.restartIce === 'function') {
        try {
          this.pc.restartIce();
          this.bus.emit("network", { type: "ice-restart", reason });
        } catch (e) {
          console.warn("[webrtc] restartIce failed", e);
          this.bus.emit("network", { type: "ice-restart-failed", error: e });
        }
      }
      this.bus.emit("network", {
        type: "ice-reconnect-required",
        fatal: true,
        reason,
        state,
        message: "WebRTC ICE did not recover before the reconnect grace period; reloading the source."
      });
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
    const pc = this.pc;
    const generation = this.generation;
    const report = await pc.getStats().catch(() => null);
    if (pc !== this.pc || generation !== this.generation) return;
    if (!report) return;
    let packetsLost: number | null = null;
    report.forEach((s) => {
      const inbound = s as InboundRtpStats;
      if (inbound.type === "inbound-rtp" && inbound.kind === "video" && !inbound.isRemote) {
        packetsLost = typeof inbound.packetsLost === 'number' ? inbound.packetsLost : packetsLost;
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
      ? this.omePlaylist.findIndex((r) => r?.name === this.currentRendition || r?.rendition_name === this.currentRendition)
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
  private async computeRtcStats() {
    const base = super.getStats();
    if (!this.pc) return base;
    const pc = this.pc;
    const generation = this.generation;
    const report = await pc.getStats();
    if (pc !== this.pc || generation !== this.generation) return base;
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
    const localCandidates = new Map<string, IceCandidateStats>();
    const remoteCandidates = new Map<string, IceCandidateStats>();
    let jitterMs: number | undefined;
    let rttMs: number | undefined;
    let bitrateKbps: number | undefined;
    let fps: number | undefined;
    let packetsLost: number | undefined;
    let packetsRecv: number | undefined;
    let candidateType: string | undefined;
    let localCandidateType: string | undefined;
    let remoteCandidateType: string | undefined;
    let transport: string | undefined;
    let audioBytesReceived: number | undefined;
    let audioPacketsReceived: number | undefined;
    let audioPacketsLost: number | undefined;
    report.forEach((s) => {
      const inbound = s as InboundRtpStats;
      const pair = s as CandidatePairStats;
      const track = s as TrackStats;
      const candidate = s as IceCandidateStats;

      if (inbound.type === "inbound-rtp" && inbound.kind === "video") {
        bytes += inbound.bytesReceived || 0;
        frames += inbound.framesDecoded || 0;
        framesDecoded = inbound.framesDecoded;
        framesDropped = inbound.framesDropped;
        framesReceived = inbound.packetsReceived;
        pliCount = inbound.pliCount;
        nackCount = inbound.nackCount;
        firCount = inbound.firCount;
        if (inbound.jitterBufferDelay !== undefined && inbound.jitterBufferEmittedCount) {
          const avg = inbound.jitterBufferDelay / inbound.jitterBufferEmittedCount;
          jitterBufferMs = Math.round(avg * 1000);
        }
        if (inbound.totalDecodeTime !== undefined && inbound.framesDecoded) {
          decodeMs = Math.round((inbound.totalDecodeTime / inbound.framesDecoded) * 1000);
        }
        packetsLost = inbound.packetsLost;
        packetsRecv = inbound.packetsReceived;
      }
      if (pair.type === "candidate-pair" && pair.state === "succeeded") {
        rttMs = Math.round((pair.currentRoundTripTime || 0) * 1000);
        candidatePairId = pair.id;
      }
      if (inbound.type === "inbound-rtp" && inbound.kind === "audio") {
        audioBytesReceived = inbound.bytesReceived;
        audioPacketsReceived = inbound.packetsReceived;
        audioPacketsLost = inbound.packetsLost;
        if (inbound.jitter !== undefined) {
          jitterMs = Math.round((inbound.jitter || 0) * 1000);
        }
      }
      if (track.type === "track" && track.kind === "video") {
        width = track.frameWidth ?? width;
        height = track.frameHeight ?? height;
      }
      if (candidate.type === "local-candidate") {
        localCandidates.set(candidate.id, candidate);
      }
      if (candidate.type === "remote-candidate") {
        remoteCandidates.set(candidate.id, candidate);
      }
    });
    // Resolve selected candidate info
    if (candidatePairId) {
      const pair = Array.from(report.values()).find((s) => s.id === candidatePairId) as CandidatePairStats | undefined;
      const local = pair?.localCandidateId ? localCandidates.get(pair.localCandidateId) : null;
      const remote = pair?.remoteCandidateId ? remoteCandidates.get(pair.remoteCandidateId) : null;
      localCandidateType = local?.candidateType;
      remoteCandidateType = remote?.candidateType;
      candidateType = remoteCandidateType || localCandidateType;
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
      droppedFrames: framesDropped ?? base.droppedFrames,
      framesReceived,
      audioBytesReceived,
      audioPacketsReceived,
      audioPacketsLost,
      pliCount,
      nackCount,
      firCount,
      width: width ?? base.width,
      height: height ?? base.height,
      candidateType,
      localCandidateType,
      remoteCandidateType,
      transport
    };
  }
}
