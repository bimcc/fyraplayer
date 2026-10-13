/** Application-owned session scheduling. No global DOM or SDK internals. */
export interface MultiViewResource {
  /** Resolve after startup/playback; reject when startup fails. Observe signal promptly. */
  start(signal: AbortSignal): Promise<void>;
  /** Idempotent: release all owned Player/plugin/transport resources. */
  destroy(): Promise<void>;
}
export interface MultiViewTile {
  id: string;
  /** Synchronous allocation only. Start requests in resource.start(). */
  create(): MultiViewResource;
  enabled?: boolean;
  visible?: boolean;
}
export interface MultiViewSnapshot {
  active: boolean;
  pageVisible: boolean;
  focused: string | null;
  maxActive: number;
  maxStarting: number;
  allocated: number;
  starting: number;
  tiles: Array<{ id: string; enabled: boolean; visible: boolean;
    state: 'disabled' | 'offscreen' | 'background' | 'queued' | 'starting' | 'active' | 'releasing' | 'error'; error?: string }>;
}
export interface MultiViewOptions {
  maxActive?: number;
  maxStarting?: number;
  startupTimeoutMs?: number;
  onChange?: (snapshot: MultiViewSnapshot) => void;
}
type Entry = MultiViewTile & { enabled: boolean; visible: boolean; removed?: boolean; error?: string; lease?: Lease };
type Lease = { controller: AbortController; starting: boolean; retiring: boolean; resource?: MultiViewResource;
  work: Promise<void>; closing?: Promise<void>; cleanupError?: string };

export class MultiViewCoordinator {
  private entries = new Map<string, Entry>();
  private alive = true;
  private pageVisible = true;
  private focused: string | null = null;
  private maxActive: number;
  private maxStarting: number;
  private startupTimeoutMs: number;
  private queued = false;
  private destruction?: Promise<void>;

  constructor(private options: MultiViewOptions = {}) {
    this.maxActive = this.limit(options.maxActive ?? 4);
    this.maxStarting = this.limit(options.maxStarting ?? 2);
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15000;
    if (!Number.isFinite(this.startupTimeoutMs) || this.startupTimeoutMs < 100 || this.startupTimeoutMs > 120000) throw new RangeError('Invalid startup timeout');
  }
  private limit(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 32) throw new RangeError('Budget must be an integer from 1 to 32');
    return value;
  }
  private entry(id: string): Entry {
    if (!this.alive) throw new Error('Coordinator destroyed');
    const entry = this.entries.get(id);
    if (!entry || entry.removed) throw new Error(`Unknown tile: ${id}`);
    return entry;
  }
  add(tile: MultiViewTile): void {
    if (!this.alive) throw new Error('Coordinator destroyed');
    if (!tile.id || this.entries.has(tile.id)) throw new Error('Tile id must be unique (including pending cleanup)');
    this.entries.set(tile.id, { ...tile, enabled: tile.enabled ?? false, visible: tile.visible ?? true });
    this.schedule();
  }
  setEnabled(id: string, enabled: boolean): void {
    const entry = this.entry(id); entry.enabled = enabled;
    if (!enabled) this.retire(entry);
    this.schedule();
  }
  setVisible(id: string, visible: boolean): void {
    const entry = this.entry(id); entry.visible = visible;
    if (!visible) this.retire(entry);
    this.schedule();
  }
  focus(id: string | null): void { if (id !== null) this.entry(id); this.focused = id; this.schedule(); }
  setPageVisible(visible: boolean): void {
    if (!this.alive) return;
    this.pageVisible = visible;
    if (!visible) for (const entry of this.entries.values()) this.retire(entry);
    this.schedule();
  }
  setBudget(maxActive: number, maxStarting = this.maxStarting): void {
    const active = this.limit(maxActive), starting = this.limit(maxStarting);
    this.maxActive = active; this.maxStarting = starting; this.schedule();
  }
  retry(id: string): void {
    const entry = this.entry(id); entry.error = undefined;
    if (entry.lease?.cleanupError) {
      entry.lease.cleanupError = undefined; entry.lease.closing = undefined;
      this.close(entry, entry.lease);
    }
    this.schedule();
  }
  /** Feed only terminal failures; intermediate retries remain owned by the Player. */
  fail(id: string, error: unknown): void {
    const entry = this.entry(id);
    entry.error = error instanceof Error ? error.message : String(error);
    this.retire(entry); this.schedule();
  }
  remove(id: string): void {
    const entry = this.entry(id); entry.removed = true; entry.enabled = false;
    if (this.focused === id) this.focused = null;
    this.retire(entry);
    if (!entry.lease) this.entries.delete(id);
    this.schedule();
  }
  snapshot(): MultiViewSnapshot {
    const entries = [...this.entries.values()];
    return { active: this.alive, pageVisible: this.pageVisible, focused: this.focused,
      maxActive: this.maxActive, maxStarting: this.maxStarting,
      allocated: entries.filter(e => e.lease).length, starting: entries.filter(e => e.lease?.starting).length,
      tiles: entries.map(e => ({ id: e.id, enabled: e.enabled, visible: e.visible, error: e.lease?.cleanupError ?? e.error,
        state: e.lease?.cleanupError ? 'error' : e.lease?.retiring ? 'releasing' : e.error ? 'error'
          : e.lease ? e.lease.starting ? 'starting' : 'active' : !e.enabled ? 'disabled'
            : !this.pageVisible ? 'background' : !e.visible ? 'offscreen' : 'queued' })) };
  }
  destroy(): Promise<void> {
    if (this.destruction) return this.destruction;
    this.alive = false;
    for (const entry of this.entries.values()) this.retire(entry);
    this.destruction = (async () => {
      for (const entry of this.entries.values()) {
        const lease = entry.lease;
        if (!lease) continue;
        await lease.work;
        await lease.closing;
      }
      this.publish();
      if ([...this.entries.values()].some(e => e.lease?.cleanupError)) throw new Error('A tile failed to release its resources');
    })();
    this.schedule();
    return this.destruction;
  }
  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; this.reconcile(); });
  }
  private reconcile(): void {
    const entries = [...this.entries.values()];
    const desired = this.alive && this.pageVisible ? entries.filter(e => e.enabled && e.visible && !e.removed && !e.error)
      .sort((a, b) => Number(b.id === this.focused) - Number(a.id === this.focused)).slice(0, this.maxActive) : [];
    for (const entry of entries) if (!desired.includes(entry)) this.retire(entry);
    for (const entry of desired) {
      const current = this.snapshot();
      if (current.allocated >= this.maxActive || current.starting >= this.maxStarting) break;
      if (!entry.lease) this.start(entry);
    }
    this.publish();
  }
  private start(entry: Entry): void {
    const lease: Lease = { controller: new AbortController(), starting: true, retiring: false, work: Promise.resolve() };
    entry.lease = lease;
    lease.work = Promise.resolve().then(async () => {
      if (lease.retiring) return;
      const timer = setTimeout(() => {
        if (lease.retiring) return;
        entry.error = 'Startup timed out'; this.retire(entry); this.schedule();
      }, this.startupTimeoutMs);
      try {
        lease.resource = entry.create();
        if (lease.retiring) { this.close(entry, lease); return; }
        await lease.resource.start(lease.controller.signal);
      } catch (error) {
        if (!lease.retiring) { entry.error = error instanceof Error ? error.message : String(error); this.retire(entry); }
      } finally { clearTimeout(timer); }
    }).finally(() => {
      lease.starting = false;
      if (lease.retiring) this.close(entry, lease);
      this.schedule();
    });
  }
  private retire(entry: Entry): void {
    const lease = entry.lease;
    if (!lease || lease.retiring) return;
    lease.retiring = true;
    lease.controller.abort();
    // Abort/destroy now, even when start() is waiting for network headers.
    this.close(entry, lease);
  }
  private close(entry: Entry, lease: Lease): void {
    if (lease.closing || (lease.starting && !lease.resource)) return;
    const release = lease.resource ? (() => { try { return lease.resource!.destroy(); } catch (error) { return Promise.reject(error); } })() : Promise.resolve();
    lease.closing = release.catch(error => {
      lease.cleanupError = error instanceof Error ? error.message : String(error);
    }).then(async () => {
      await lease.work;
      // Failed or incomplete cleanup continues to occupy budget: never overbook decoders.
      if (!lease.cleanupError && entry.lease === lease) {
        entry.lease = undefined;
        if (entry.removed) this.entries.delete(entry.id);
      }
      this.schedule();
    });
  }
  private publish(): void {
    try { this.options.onChange?.(this.snapshot()); } catch { /* Reporting must not interrupt scheduling. */ }
  }
}
