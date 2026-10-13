import type { AutoSource, MiddlewareEntry, PluginCtor, Source } from '../types.js';
import { abortReason, throwIfAborted, waitWithSignal } from '../core/abort.js';

/** Backend-owned session and already converted browser playback sources. */
export interface GbGatewaySession {
  id: string;
  source: Source;
  fallbacks?: Source[];
  data?: unknown;
}
export type GbGatewayReleaseReason = 'replaced' | 'cancelled' | 'failed' | 'stop' | 'destroy' | 'manual';
export interface GbGatewayAdapterOptions {
  /** Resolve auto sources with this engine name; defaults to gb-gateway. */
  engine?: string;
  /** Own HTTP/auth/response mapping in the application; return a concrete Source. */
  invite(source: AutoSource, signal: AbortSignal): Promise<GbGatewaySession>;
  /** Optional explicit backend release policy; no endpoint or BYE payload is guessed. */
  release?(session: GbGatewaySession, reason: GbGatewayReleaseReason): Promise<void> | void;
  control?(session: GbGatewaySession, action: string, payload: unknown, signal: AbortSignal): Promise<unknown>;
  onError?(error: unknown): void;
}
export interface GbGatewayAdapter {
  middleware: MiddlewareEntry;
  plugin: PluginCtor;
  getSession(): GbGatewaySession | null;
  control(action: string, payload?: unknown): Promise<unknown>;
  release(): Promise<void>;
}

/** One adapter per Player: control plane stays separate from the selected media Tech. */
export function createGbGatewayAdapter(options: GbGatewayAdapterOptions): GbGatewayAdapter {
  let owner = false, disposed = false, generation = 0;
  let current: { session: GbGatewaySession; controller: AbortController } | null = null;
  const releases = new Set<Promise<void>>();
  const report = (error: unknown) => { try { options.onError?.(error); } catch { /* observer isolation */ } };
  const releaseSession = (session: GbGatewaySession, reason: GbGatewayReleaseReason): Promise<void> => {
    const work = Promise.resolve().then(() => options.release?.(session, reason));
    releases.add(work);
    void work.then(() => releases.delete(work), error => { releases.delete(work); report(error); });
    return work;
  };
  const clear = (reason: GbGatewayReleaseReason) => {
    generation++;
    const previous = current;
    current = null;
    if (!previous) return Promise.resolve();
    previous.controller.abort();
    return releaseSession(previous.session, reason);
  };
  const adapter: GbGatewayAdapter = {
    middleware: {
      kind: 'resolve',
      async fn(ctx) {
        if (ctx.source.type !== 'auto' || ctx.source.engine !== (options.engine ?? 'gb-gateway')) return;
        if (!owner || disposed) throw new Error('Install this gateway adapter.plugin on its Player before resolving sources');
        const cleanup = clear('replaced');
        const token = generation;
        await waitWithSignal(cleanup, ctx.signal);
        throwIfAborted(ctx.signal);
        if (disposed || token !== generation) throw new DOMException('Gateway session superseded', 'AbortError');
        const signal = ctx.signal ?? new AbortController().signal;
        const pending = Promise.resolve().then(() => options.invite(ctx.source as AutoSource, signal)).then(async session => {
          if (signal.aborted || disposed || generation !== token) {
            await releaseSession(session, 'cancelled').catch(() => {});
            throw signal.aborted ? abortReason(signal) : new DOMException('Gateway session superseded', 'AbortError');
          }
          const concrete = (sources:Source[]):boolean => {
            const seen = new Set<Source>();
            const pending = [...sources];
            while (pending.length) {
              const source = pending.pop()!;
              if (source.type === 'auto' || source.type === 'gb28181') return false;
              if (seen.has(source)) continue;
              seen.add(source);
              pending.push(...(source.fallbacks ?? []));
            }
            return true;
          };
          if (!session.id || !concrete([session.source, ...(session.fallbacks ?? [])])) {
            await releaseSession(session, 'failed').catch(() => {});
            throw new Error('Gateway invite must return an id and concrete browser playback Sources');
          }
          const controller = new AbortController();
          current = {session, controller};
          return session;
        });
        const session = await waitWithSignal(pending, signal);
        if (signal.aborted || disposed || token !== generation) {
          if (current?.session === session) await clear('cancelled');
          throw signal.aborted ? abortReason(signal) : new DOMException('Gateway session superseded','AbortError');
        }
        // Preserve presentation hints, while allowing the backend to specify its own.
        return {resolvedSources: {
          primary: {presentation:ctx.source.presentation, tags:ctx.source.tags, meta:ctx.source.meta, ...session.source},
          fallbacks: session.fallbacks ?? session.source.fallbacks ?? [],
        }};
      },
    },
    plugin: ctx => {
      if (owner || disposed) throw new Error('A gateway adapter belongs to exactly one Player; create a fresh adapter');
      owner = true;
      let exhausted = false;
      const reset = (value: unknown) => {
        const reason = (value as {reason?: string})?.reason;
        if (reason === 'failed' && exhausted) {exhausted=false;void clear('failed').catch(() => {});return;}
        if (reason !== 'failed') exhausted=false;
        // A failed Tech attempt can emit error before its fallback is selected.
        // Terminal load failure is identified by the later core error with no session.
        if (['load', 'switch', 'reconnect', 'stop', 'destroy'].includes(reason ?? '')) {
          const releaseReason = reason === 'stop' || reason === 'destroy' ? reason : 'replaced';
          void clear(releaseReason).catch(() => {});
        }
      };
      const failed = () => {
        if (ctx.player.getState() === 'error' && ctx.player.getPlaybackSession?.() === null) void clear('failed').catch(() => {});
      };
      const network = (value:unknown) => {
        if ((value as {type?:string})?.type === 'reconnect-exhausted') exhausted=true;
      };
      ctx.coreBus.on('sessionchange', reset);
      ctx.coreBus.on('error', failed);
      ctx.coreBus.on('network', network);
      const cancel = () => { disposed = true; void clear('destroy').catch(() => {}); };
      ctx.lifecycle?.signal.addEventListener('abort', cancel, {once:true});
      if (ctx.lifecycle?.signal.aborted) cancel();
      return {async destroy() {
        ctx.coreBus.off('sessionchange', reset);
        ctx.coreBus.off('error', failed);
        ctx.coreBus.off('network', network);
        ctx.lifecycle?.signal.removeEventListener('abort', cancel);
        cancel();
        await Promise.allSettled([...releases]);
      }};
    },
    getSession: () => current?.session ?? null,
    async control(action, payload) {
      const active = current;
      if (!active || disposed) throw new Error('No active gateway session');
      if (!options.control) throw new Error('Gateway control callback is not configured');
      return waitWithSignal(options.control(active.session, action, payload, active.controller.signal), active.controller.signal);
    },
    release: () => clear('manual'),
  };
  return adapter;
}
