import { TechName, Source, BufferPolicy, MetricsOptions, ReconnectPolicy, Tech, DataChannelOptions } from '../types.js';
import { EventBus } from './eventBus.js';

interface TechEntry {
  name: TechName;
  impl: Tech;
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
    this.techs.push({ name, impl });
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

  getCurrentTechName(): TechName | null {
    return this.current?.name ?? null;
  }

  /**
   * Mark a tech as failed to avoid repeated failures in the same session
   * Requirements 5.5: Track failed Techs
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
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
      webCodecs?: import('../types.js').WebCodecsConfig;
      dataChannel?: DataChannelOptions;
    }
  ): Promise<{ source: Source; tech: TechName } | null> {
    await this.destroyCurrent();
    const errors: { tech: TechName; source: Source; reason: any }[] = [];
    
    // Requirements 5.5: Filter out failed techs
    const effectiveOrder = techOrder.filter(t => !this.failedTechs.has(t));
    
    for (const source of sources) {
      // Try primary source first
      const result = await this.tryLoadSource(source, effectiveOrder, opts, errors);
      if (result) return result;
      
      // Requirements 5.2: Try fallbacks if primary fails
      if ('fallbacks' in source && source.fallbacks && source.fallbacks.length > 0) {
        for (const fallback of source.fallbacks) {
          const fbResult = await this.tryLoadSource(fallback, effectiveOrder, opts, errors);
          if (fbResult) {
            // Requirements 5.4: Emit fallback event
            this.bus.emit('network', {
              type: 'fallback',
              from: source.type,
              to: fallback.type
            });
            return fbResult;
          }
        }
      }
    }
    
    if (errors.length) {
      const detail = errors
        .map((e) => `${e.tech} (${(e.source as any)?.url ?? e.source.type}): ${(e.reason as any)?.message ?? e.reason}`)
        .join('; ');
      const err: any = new Error(`No compatible tech/source. Reasons: ${detail}`);
      err.causes = errors;
      throw err;
    }
    return null;
  }

  /**
   * Try to load a single source with the given tech order
   */
  private async tryLoadSource(
    source: Source,
    techOrder: TechName[],
    opts: {
      buffer?: BufferPolicy;
      reconnect?: ReconnectPolicy;
      metrics?: MetricsOptions;
      video: HTMLVideoElement;
      webCodecs?: import('../types.js').WebCodecsConfig;
      dataChannel?: DataChannelOptions;
    },
    errors: { tech: TechName; source: Source; reason: any }[]
  ): Promise<{ source: Source; tech: TechName } | null> {
    // Requirements 5.6: Respect user-configured techOrder as priority
    const preferred = (source as any).preferTech as TechName | undefined;
    const ordered = preferred ? [preferred, ...techOrder.filter((t) => t !== preferred)] : techOrder;
    
    for (const name of ordered) {
      // Skip failed techs
      if (this.failedTechs.has(name)) continue;
      
      const impl = this.techs.find((t) => t.name === name)?.impl;
      if (!impl || !impl.canPlay(source)) continue;
      
      try {
        await impl.load(source, opts);
        this.current = { name, impl };
        return { source, tech: name };
      } catch (err) {
        errors.push({ tech: name, source, reason: err });
        console.warn(`[techManager] load failed for ${name}`, err);
        // Mark tech as failed for this session
        this.markTechFailed(name);
      }
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
      await this.current.impl.destroy();
      this.current = null;
    }
  }
}
