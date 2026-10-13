import type { PlaybackSessionChange, PlayerNetworkEvent, PluginCtor, Source } from '../types.js';
import { createFrameClockPlugin, type FrameClockHandle } from './frame-clock.js';

export type PlaybackHealthStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking'
  | 'suspended' | 'stalled' | 'error' | 'ended' | 'stopped' | 'destroyed';
export type PlaybackHealthPrecision = 'video-frame' | 'media-event' | 'external-frame' | 'unavailable';
export type PlaybackStallReason = 'media-wait' | 'frame-gap' | 'first-frame-wait';
export type PlaybackHealthEndReason = 'progress' | 'pause' | 'suspended' | 'seek' | 'sessionchange' | 'stop' | 'ended' | 'error' | 'destroy';
export interface PlaybackHealthEvent {
  type: 'state' | 'first-frame' | 'recovery' | 'stall' | 'stall-end' | 'observation-gap' | 'error';
  /** performance.now() milliseconds, not UTC or camera capture time. */
  observedAt: number;
  sessionEpoch?: number;
  status: PlaybackHealthStatus;
  precision: PlaybackHealthPrecision;
  durationMs?: number;
  startedAt?: number;
  stallReason?: PlaybackStallReason;
  endReason?: PlaybackHealthEndReason;
}
export interface PlaybackHealthError {
  kind: 'autoplay' | 'transport' | 'media-network' | 'decode' | 'unsupported' | 'timeout' | 'unknown';
  message: string;
  code?: string;
}
export interface PlaybackHealthSnapshot {
  active: boolean;
  observedAt: number;
  status: PlaybackHealthStatus;
  precision: PlaybackHealthPrecision;
  sessionEpoch?: number;
  source?: Source;
  firstFrameMs?: number;
  recoveryMs?: number;
  mediaTime?: number;
  lastProgressAt?: number;
  stall?: { reason: PlaybackStallReason; startedAt: number; detectedAt: number; durationMs: number };
  /** Counts/totals across this plugin lifetime, including interrupted observed episodes. */
  stallCount: number;
  totalStallMs: number;
  suspendedReason?: 'document-hidden' | 'application';
  lastError?: PlaybackHealthError;
  recent: PlaybackHealthEvent[];
}
export interface PlaybackHealthHandle {
  snapshot(): PlaybackHealthSnapshot;
  /** External renderer clock. Modern hosts require the current sessionEpoch. */
  reportFrame(sample: { mediaTime: number; sessionEpoch?: number }): boolean;
  /** Applications can exclude offscreen tiles or known rendering suspension. */
  setSuspended(suspended: boolean): void;
  destroy(): void;
}
export interface PlaybackHealthPluginOptions {
  stallThresholdMs?: number;
  checkIntervalMs?: number;
  maxEvents?: number;
  /** external avoids using captureStream's clock for custom canvas renderers. */
  frameSource?: 'video' | 'external';
  fallback?: 'media-events' | 'none';
  /** Publish stall/progress recovery to existing qos reporters. Defaults to true. */
  emitQos?: boolean;
  onHandle?: (handle: PlaybackHealthHandle) => void;
  onEvent?: (event: PlaybackHealthEvent, snapshot: PlaybackHealthSnapshot) => void;
  onSnapshot?: (snapshot: PlaybackHealthSnapshot) => void;
  onError?: (error: unknown) => void;
}

/** Passive per-player observation; does not reconnect, seek, or change playback. */
export function createPlaybackHealthPlugin(options: PlaybackHealthPluginOptions = {}): PluginCtor {
  const threshold = options.stallThresholdMs ?? 2000;
  const interval = options.checkIntervalMs ?? 250;
  const maxEvents = options.maxEvents ?? 100;
  if (!Number.isFinite(threshold) || threshold < 100 || threshold > 60000) throw new RangeError('Invalid stallThresholdMs');
  if (!Number.isFinite(interval) || interval < 50 || interval > threshold) throw new RangeError('Invalid checkIntervalMs');
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 1000) throw new RangeError('Invalid maxEvents');
  return context => {
    const { player, coreBus, lifecycle } = context;
    const video = player.getVideoElement();
    const visibility = video.ownerDocument ?? (typeof document === 'undefined' ? undefined : document);
    const hasSession = typeof player.getPlaybackSession === 'function';
    let session = player.getPlaybackSession?.() ?? null;
    let sessionEpoch = session?.epoch;
    let active = true;
    let phase: PlaybackHealthStatus = 'idle';
    let intent = player.getState() === 'playing';
    let seeking = video.seeking;
    let appSuspended = false;
    let hidden = visibility?.hidden === true;
    let precision: PlaybackHealthPrecision = options.frameSource === 'external' ? 'external-frame'
      : typeof video.requestVideoFrameCallback === 'function' && typeof video.cancelVideoFrameCallback === 'function'
        ? 'video-frame' : options.fallback === 'none' ? 'unavailable' : 'media-event';
    let attemptStart: number | undefined = hasSession ? undefined : performance.now();
    let reconnect = false;
    let firstFrameMs: number | undefined;
    let recoveryMs: number | undefined;
    let mediaTime: number | undefined;
    let lastProgressAt: number | undefined;
    let runSince: number | undefined;
    let waitingSince: number | undefined;
    let stall: { reason: PlaybackStallReason; startedAt: number; detectedAt: number } | undefined;
    let stallCount = 0;
    let totalStallMs = 0;
    let lastError: PlaybackHealthError | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let lastTick = performance.now();
    let clock: FrameClockHandle | undefined;
    const recent: PlaybackHealthEvent[] = [];
    const removers: Array<() => void> = [];
    const validSession = () => !hasSession || !!session;
    const suspended = () => hidden || appSuspended;
    const eligible = () => active && intent && validSession() && !suspended() && !seeking
      && phase !== 'error' && phase !== 'ended' && phase !== 'stopped';
    const status = (): PlaybackHealthStatus => !active ? 'destroyed'
      : phase === 'error' || phase === 'ended' || phase === 'stopped' ? phase
        : suspended() ? 'suspended' : seeking ? 'seeking' : stall ? 'stalled'
          : intent && validSession() ? 'playing' : phase;
    const snapshot = (): PlaybackHealthSnapshot => {
      const now = performance.now();
      return { active, observedAt: now, status: status(), precision, sessionEpoch,
        source: hasSession ? session?.source : player.getCurrentSource(), firstFrameMs, recoveryMs,
        mediaTime, lastProgressAt, stall: stall ? { ...stall, durationMs: Math.max(0, now - stall.startedAt) } : undefined,
        stallCount, totalStallMs, suspendedReason: hidden ? 'document-hidden' : appSuspended ? 'application' : undefined,
        lastError: lastError ? { ...lastError } : undefined, recent: recent.map(event => ({ ...event })) };
    };
    const notify = (work: () => void) => {
      try { work(); } catch (error) { try { options.onError?.(error); } catch { /* Reporter failures cannot stop observation. */ } }
    };
    const publish = (type: PlaybackHealthEvent['type'], fields: Partial<PlaybackHealthEvent> = {}) => {
      const event: PlaybackHealthEvent = { type, observedAt: performance.now(), sessionEpoch, status: status(), precision, ...fields };
      recent.push(event);
      if (recent.length > maxEvents) recent.shift();
      notify(() => options.onEvent?.({ ...event }, snapshot()));
      if (active) notify(() => options.onSnapshot?.(snapshot()));
      if (active && sessionEpoch === event.sessionEpoch && options.emitQos !== false
        && ((type === 'stall' && stall?.startedAt === event.startedAt) || (type === 'stall-end' && event.endReason === 'progress'))) {
        coreBus.emit('qos', { type: 'playback-health', code: type === 'stall' ? 'PLAYBACK_STALL' : 'PLAYBACK_RECOVERED',
          severity: type === 'stall' ? 'warning' : 'info', reason: event.stallReason, durationMs: event.durationMs,
          sessionEpoch: event.sessionEpoch, precision, ts: Date.now() });
      }
    };
    const endStall = (endReason: PlaybackHealthEndReason, at = performance.now()) => {
      if (!stall) return;
      const previous = stall;
      const durationMs = Math.max(0, at - previous.startedAt);
      stall = undefined;
      totalStallMs += durationMs;
      publish('stall-end', { startedAt: previous.startedAt, durationMs, stallReason: previous.reason, endReason });
    };
    const stopTimer = () => { if (timer !== undefined) clearInterval(timer); timer = undefined; };
    const rebase = () => { runSince = performance.now(); lastProgressAt = undefined; waitingSince = undefined; lastTick = runSince; };
    const tick = () => {
      const now = performance.now();
      if (!eligible()) { stopTimer(); return; }
      if (now - lastTick > Math.max(1000, interval * 4)) {
        const gap = now - lastTick;
        // The long unobserved interval is not evidence of a media stall.
        endStall('suspended', lastTick);
        rebase();
        publish('observation-gap', { durationMs: gap });
        return;
      }
      lastTick = now;
      const since = waitingSince ?? lastProgressAt ?? runSince;
      // No frame API or injected clock: only explicit media waiting is observable.
      if (stall || since === undefined || (precision === 'unavailable' && waitingSince === undefined) || now - since < threshold) return;
      stall = { reason: waitingSince !== undefined ? 'media-wait' : mediaTime === undefined ? 'first-frame-wait' : 'frame-gap', startedAt: since, detectedAt: now };
      stallCount++;
      publish('stall', { startedAt: since, durationMs: now - since, stallReason: stall.reason });
    };
    const watch = () => {
      if (!eligible()) { stopTimer(); return; }
      if (timer === undefined) { lastTick = performance.now(); timer = setInterval(tick, interval); }
    };
    const progress = (time: number, samplePrecision: PlaybackHealthPrecision, epoch?: number): boolean => {
      if (!active || !validSession() || suspended() || seeking || !Number.isFinite(time)
        || phase === 'error' || phase === 'ended' || phase === 'stopped'
        || (hasSession && epoch !== sessionEpoch)) return false;
      if (mediaTime === time) return false;
      const now = performance.now();
      const epochAtFrame = sessionEpoch;
      mediaTime = time;
      lastProgressAt = now;
      waitingSince = undefined;
      precision = samplePrecision;
      const first = firstFrameMs === undefined && attemptStart !== undefined;
      if (first) {
        firstFrameMs = Math.max(0, now - attemptStart!);
        publish('first-frame', { durationMs: firstFrameMs, startedAt: attemptStart });
        if (active && epochAtFrame === sessionEpoch && reconnect) { recoveryMs = firstFrameMs; reconnect = false; publish('recovery', { durationMs: recoveryMs, startedAt: attemptStart }); }
      }
      if (active && epochAtFrame === sessionEpoch) { endStall('progress'); watch(); }
      return true;
    };
    const pause = () => {
      if (!active || phase === 'ended' || phase === 'error' || phase === 'stopped') return;
      intent = false; phase = 'paused'; stopTimer(); endStall('pause'); publish('state');
    };
    const play = () => {
      if (!active || !validSession()) return;
      if (!intent) rebase();
      intent = true; phase = 'playing'; watch(); publish('state');
    };
    const terminal = (next: 'stopped' | 'ended' | 'error', reason: PlaybackHealthEndReason) => {
      if (!active) return;
      intent = false; phase = next; stopTimer(); endStall(reason); publish('state');
    };
    const resetTimeline = () => {
      stopTimer(); endStall('sessionchange');
      mediaTime = undefined; lastProgressAt = undefined; waitingSince = undefined; runSince = undefined;
      seeking = false;
    };
    const sessionChange = (event: PlaybackSessionChange) => {
      if (!active) return;
      if (event.epoch === sessionEpoch) { session = event.session; return; }
      if (sessionEpoch !== undefined && event.epoch < sessionEpoch) return;
      if (event.reason === 'stop') { phase = 'stopped'; intent = false; stopTimer(); endStall('stop'); }
      else if (event.reason !== 'destroy') resetTimeline();
      if (!active || (sessionEpoch !== undefined && event.epoch <= sessionEpoch)) return;
      session = event.session; sessionEpoch = event.epoch;
      if (event.reason === 'destroy') { handle.destroy(); return; }
      if (event.reason === 'stop') { mediaTime = undefined; lastProgressAt = undefined; publish('state'); return; }
      if (event.reason === 'load' || event.reason === 'switch' || event.reason === 'reconnect' || event.reason === 'discontinuity' || event.reason === 'fallback') {
        attemptStart = performance.now(); firstFrameMs = undefined; recoveryMs = undefined;
        reconnect = event.reason === 'reconnect'; lastError = undefined;
      }
      attemptStart ??= performance.now();
      if (event.reason === 'load' || event.reason === 'switch' || event.reason === 'reconnect') intent = false;
      phase = event.reason === 'failed' ? 'error' : event.session?.status === 'loaded' ? 'ready' : 'loading';
      if (event.session && intent) rebase();
      watch(); publish('state');
    };
    const mediaWait = () => {
      if (!eligible()) return;
      waitingSince ??= performance.now(); watch();
    };
    const error = (value: unknown) => {
      if (!active) return;
      const native = video.error;
      const name = value instanceof Error ? value.name : '';
      lastError = { kind: name === 'TimeoutError' ? 'timeout' : native?.code === 2 ? 'media-network'
        : native?.code === 3 ? 'decode' : native?.code === 4 ? 'unsupported' : 'unknown',
        message: value instanceof Error ? value.message : String(value ?? 'Playback error') };
      terminal('error', 'error'); publish('error');
    };
    const network = (event: PlayerNetworkEvent | undefined) => {
      if (!active || !event) return;
      if (event.type === 'autoplay-blocked' || event.code === 'AUTOPLAY_BLOCKED') {
        lastError = { kind: 'autoplay', code: event.code, message: event.message ?? 'User gesture required' }; pause();
      } else if (event.fatal || event.severity === 'fatal') {
        lastError = { kind: 'transport', code: event.code, message: event.message ?? event.type ?? 'Transport failure' };
        terminal('error', 'error'); publish('error');
      }
    };
    const suspension = () => {
      if (!active) return;
      stopTimer(); endStall('suspended'); rebase(); watch(); publish('state');
    };
    const addPlayer = (name: string, handler: (...args: any[]) => void) => {
      player.on(name, handler); removers.push(() => player.off(name, handler));
    };
    const addVideo = (name: string, handler: () => void) => {
      video.addEventListener(name, handler); removers.push(() => video.removeEventListener(name, handler));
    };
    const handle: PlaybackHealthHandle = {
      snapshot,
      reportFrame: sample => options.frameSource === 'external' && progress(sample.mediaTime, 'external-frame', sample.sessionEpoch),
      setSuspended: value => { if (active && appSuspended !== value) { appSuspended = value; suspension(); } },
      destroy: () => {
        if (!active) return;
        active = false; stopTimer(); clock?.destroy();
        endStall('destroy');
        removers.splice(0).forEach(remove => remove());
        lifecycle?.signal.removeEventListener('abort', handle.destroy);
        publish('state');
      }
    };
    lifecycle?.onCleanup(handle.destroy);
    lifecycle?.signal.addEventListener('abort', handle.destroy, { once: true });
    try {
      if (lifecycle?.signal.aborted) handle.destroy();
      if (active) {
        if (session) { attemptStart = performance.now(); phase = session.status === 'loaded' ? 'ready' : 'loading'; }
        if (hasSession) addPlayer('sessionchange', sessionChange);
        else addPlayer('sourcechange', () => { resetTimeline(); intent = false; attemptStart = performance.now(); firstFrameMs = undefined; recoveryMs = undefined; phase = 'loading'; publish('state'); });
        addPlayer('play', play); addPlayer('pause', pause);
        addPlayer('stop', () => terminal('stopped', 'stop'));
        addPlayer('ended', () => terminal('ended', 'ended'));
        addPlayer('error', error); addPlayer('network', network);
        addPlayer('ready', () => { if (active && phase === 'loading') { phase = 'ready'; publish('state'); } });
        addVideo('play', play);
        addVideo('pause', () => { if ((!hasSession || session?.status === 'loaded') && !video.ended) pause(); });
        addVideo('waiting', mediaWait); addVideo('stalled', mediaWait);
        addVideo('ended', () => { if (validSession()) terminal('ended', 'ended'); });
        addVideo('seeking', () => { if (!active || !validSession()) return; seeking = true; stopTimer(); endStall('seek'); publish('state'); });
        addVideo('seeked', () => { if (!active || !validSession()) return; seeking = false; mediaTime = undefined; rebase(); watch(); publish('state'); });
        if (visibility) {
          const changed = () => { const next = visibility.hidden === true; if (hidden !== next) { hidden = next; suspension(); } };
          visibility.addEventListener('visibilitychange', changed);
          removers.push(() => visibility.removeEventListener('visibilitychange', changed));
        }
        if (options.frameSource !== 'external') {
          clock = createFrameClockPlugin({ fallback: options.fallback, onFrame: sample => progress(sample.mediaTime, sample.precision, sample.sessionEpoch), onError: options.onError })(context) as FrameClockHandle;
        }
        if (intent) rebase();
        watch();
      }
      options.onHandle?.(handle);
    } catch (failure) { handle.destroy(); throw failure; }
    return handle;
  };
}
