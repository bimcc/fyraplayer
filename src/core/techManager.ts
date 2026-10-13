import { TechName, Source, Tech, TechLoadOptions } from '../types.js';
import { EventBus } from './eventBus.js';
import { enhanceNetworkEvent } from './networkEvents.js';
import { abortReason, createLoadScope, throwIfAborted } from './abort.js';

interface TechEntry {
  name: TechName;
  impl: Tech;
}

interface TechLoadError {
  tech: TechName;
  source: Source;
  reason: unknown;
}

interface SelectionOptions extends TechLoadOptions {
  onTechWillLoad?: (name: TechName, tech: Tech, source: Source, signal: AbortSignal) => void;
  onTechLoadFailed?: () => void;
  shouldContinue?: () => boolean;
  loadTimeoutMs?: number;
}

type SourceWithPreferTech = Source & {
  preferTech?: TechName;
};

class TechSelectionError extends Error {
  causes: TechLoadError[];

  constructor(message: string, causes: TechLoadError[]) {
    super(message);
    this.name = 'TechSelectionError';
    this.causes = causes;
  }
}

export class TechManager {
  private techs: TechEntry[] = [];
  private current: TechEntry | null = null;
  private failedTechs = new Set<TechName>();
  private bus: EventBus;

  constructor(bus?: EventBus) {
    this.bus = bus ?? new EventBus();
  }

  register(name: TechName, impl: Tech): void {
    if (this.techs.some((t) => t.name === name)) {
      throw new Error(`Tech already registered: ${name}`);
    }
    this.techs.push({ name, impl });
  }

  /**
   * Replace an existing tech implementation or register it if missing.
   * Active tech replacement is intentionally rejected because plugin
   * registration is synchronous while active tech teardown is asynchronous.
   */
  replace(name: TechName, impl: Tech): void {
    if (this.current?.name === name) {
      throw new Error(`Cannot replace active tech: ${name}`);
    }
    const index = this.techs.findIndex((t) => t.name === name);
    if (index >= 0) {
      this.techs[index] = { name, impl };
    } else {
      this.techs.push({ name, impl });
    }
    this.failedTechs.delete(name);
  }

  /**
   * Unregister a tech by name.
   * Note: If the tech is currently active, it will be destroyed first.
   */
  async unregister(name: TechName): Promise<void> {
    // If this tech is currently active, destroy it first
    if (this.current?.name === name) {
      await this.destroyCurrent();
    }
    
    // Remove from registered techs
    const index = this.techs.findIndex(t => t.name === name);
    if (index >= 0) {
      this.techs.splice(index, 1);
    }
    
    // Remove from failed techs if present
    this.failedTechs.delete(name);
  }

  /**
   * Get all registered tech names
   */
  getRegisteredTechs(): TechName[] {
    return this.techs.map(t => t.name);
  }

  getCurrentTech(): Tech | null {
    return this.current?.impl ?? null;
  }

  getTech(name: TechName): Tech | null {
    return this.techs.find((tech) => tech.name === name)?.impl ?? null;
  }

  getCurrentTechName(): TechName | null {
    return this.current?.name ?? null;
  }

  /**
   * Explicitly disable an unavailable Tech until resetFailedTechs().
   * Individual URL load failures do not disable same-Tech fallback sources.
   */
  markTechFailed(tech: TechName): void {
    this.failedTechs.add(tech);
  }

  /**
   * Reset failed techs tracking (e.g., on manual retry)
   */
  resetFailedTechs(): void {
    this.failedTechs.clear();
  }

  /**
   * Get the set of failed techs
   */
  getFailedTechs(): Set<TechName> {
    return new Set(this.failedTechs);
  }

  /**
   * Selects and loads a tech based on source and order.
   * Supports fallback sources (Requirements 5.2, 5.3, 5.4, 5.5, 5.6)
   */
  async selectAndLoad(
    sources: Source[],
    techOrder: TechName[],
    opts: SelectionOptions
  ): Promise<{ source: Source; tech: TechName } | null> {
    await this.destroyCurrent();
    if (opts.signal?.aborted || opts.shouldContinue?.() === false) return null;
    const errors: TechLoadError[] = [];
    
    // Requirements 5.5: Filter out failed techs
    const effectiveOrder = techOrder.filter(t => !this.failedTechs.has(t));
    
    for (const source of sources) {
      // Try primary source first
      const result = await this.tryLoadSource(source, effectiveOrder, opts, errors);
      if (opts.shouldContinue?.() === false) return null;
      if (result) return result;
      
      // Requirements 5.2: Try fallbacks if primary fails
      if ('fallbacks' in source && source.fallbacks && source.fallbacks.length > 0) {
        for (const fallback of source.fallbacks) {
          const fbResult = await this.tryLoadSource(fallback, effectiveOrder, opts, errors);
          if (opts.shouldContinue?.() === false) return null;
          if (fbResult) {
            // Requirements 5.4: Emit fallback event
            this.bus.emit('network', enhanceNetworkEvent({
              type: 'fallback',
              from: source.type,
              to: fallback.type
            }));
            return fbResult;
          }
        }
      }
    }
    
    if (errors.length) {
      const detail = errors
        .map((e) => {
          const sourceUrl = typeof e.source.url === 'string' ? e.source.url : e.source.type;
          const reasonMessage = e.reason instanceof Error ? e.reason.message : String(e.reason);
          return `${e.tech} (${sourceUrl}): ${reasonMessage}`;
        })
        .join('; ');
      throw new TechSelectionError(`No compatible tech/source. Reasons: ${detail}`, errors);
    }
    return null;
  }

  /**
   * Try to load a single source with the given tech order
   */
  private async tryLoadSource(
    source: Source,
    techOrder: TechName[],
    opts: SelectionOptions,
    errors: TechLoadError[]
  ): Promise<{ source: Source; tech: TechName } | null> {
    // Requirements 5.6: Respect user-configured techOrder as priority
    const preferred = (source as SourceWithPreferTech).preferTech;
    const ordered = preferred ? [preferred, ...techOrder.filter((t) => t !== preferred)] : techOrder;
    
    for (const name of new Set(ordered)) {
      if (opts.signal?.aborted || opts.shouldContinue?.() === false) return null;
      // Skip failed techs
      if (this.failedTechs.has(name)) continue;
      
      const impl = this.techs.find((t) => t.name === name)?.impl;
      if (!impl || !impl.canPlay(source)) continue;
      
      const scope = createLoadScope(opts.signal, opts.loadTimeoutMs);
      try {
        this.current = { name, impl };
        opts.onTechWillLoad?.(name, impl, source, scope.signal);
        throwIfAborted(scope.signal);
        // Await cooperative termination; never race/reuse an uncooperative Tech instance.
        await impl.load(source, { ...opts, signal: scope.signal });
        throwIfAborted(scope.signal);
        if (opts.shouldContinue?.() === false) {
          await this.destroyCurrent();
          return null;
        }
        return { source, tech: name };
      } catch (err) {
        scope.dispose();
        const reason = scope.signal.aborted ? abortReason(scope.signal) : err;
        if (opts.shouldContinue?.() !== false) opts.onTechLoadFailed?.();
        if (this.current?.impl === impl) {
          this.current = null;
        }
        try {
          await impl.destroy();
        } catch {
          /* ignore cleanup errors while trying fallback techs */
        }
        errors.push({ tech: name, source, reason });
        if (opts.signal?.aborted || opts.shouldContinue?.() === false) return null;
        console.warn(`[techManager] load failed for ${name}`, reason);
        // A URL failure does not disable this Tech for another source.
        // Explicit markTechFailed() remains available for unavailable Techs.
      } finally { scope.dispose(); }
    }
    
    return null;
  }

  /**
   * Get the event bus for subscribing to events
   */
  getEventBus(): EventBus {
    return this.bus;
  }

  async destroyCurrent(): Promise<void> {
    if (this.current) {
      const current = this.current;
      this.current = null;
      await current.impl.destroy();
    }
  }
}
