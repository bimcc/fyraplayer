import type { MetadataDetectedEvent, MetadataEvent, PlaybackSessionChange, PluginCtor } from '../../types.js';

/**
 * Generic bridge: takes Fyra metadata events (raw private-data/SEI payloads)
 * and hands them to an external parser (e.g., fyraklv) before invoking a consumer callback.
 */
export interface MetadataBridgeOptions<T = unknown> {
  /** Parser that converts a MetadataEvent into a typed result (sync or async). */
  parse: (event: MetadataEvent) => Promise<T> | T;
  /** Callback to receive parsed/normalized metadata (e.g., attitude/position/pts). */
  onData: (parsed: T, raw: MetadataEvent) => void;
  /** Optional error handler for parser failures. */
  onError?: (error: unknown, raw: MetadataEvent) => void;
}

export class MetadataBridge<T = unknown> {
  private active = true;
  private generation = 0;
  constructor(private readonly opts: MetadataBridgeOptions<T>) {}

  async handle(event: MetadataEvent): Promise<void> {
    if (!this.active) return;
    const generation = this.generation;
    try {
      const parsed = await this.opts.parse(event);
      if (this.active && generation === this.generation) this.opts.onData(parsed, event);
    } catch (err) {
      if (this.active && generation === this.generation) this.opts.onError?.(err, event);
    }
  }

  /** Suppress results from an old source/timeline while retaining the parser. */
  reset(): void {this.generation++;}
  destroy(): void { this.active = false;this.reset(); }
}

export interface MetadataPluginOptions<T = unknown> extends MetadataBridgeOptions<T> {
  /** Optional callback for detect-only discovery events. */
  onDetected?: (event: MetadataDetectedEvent) => void;
}

function isRawMetadataEvent(event: MetadataEvent | MetadataDetectedEvent): event is MetadataEvent {
  return event.type === 'private-data' || event.type === 'sei';
}

/**
 * Optional plugin wrapper for metadata parsing.
 *
 * Core playback emits raw `metadata` events only. Domain-specific parsing
 * semantics are supplied by the application or an independent library such
 * as fyraklv. This bridge does not implement a domain parser or synchronization.
 */
export function createMetadataPlugin<T = unknown>(opts: MetadataPluginOptions<T>): PluginCtor {
  return ({ player, lifecycle }) => {
    const bridge = new MetadataBridge<T>(opts);
    const hasSession = typeof player.getPlaybackSession === 'function';
    let epoch = player.getPlaybackSession?.()?.epoch;
    const reset = () => bridge.reset();
    const sessionChange = (event:PlaybackSessionChange) => {
      if (event.epoch !== epoch) {epoch=event.epoch;bridge.reset();}
    };
    const handler = (event: MetadataEvent | MetadataDetectedEvent) => {
      if (isRawMetadataEvent(event)) {
        if (hasSession && !player.getPlaybackSession?.()) return;
        void bridge.handle(event);
        return;
      }
      opts.onDetected?.(event);
    };

    const destroy = () => {
      bridge.destroy();
      player.off('metadata', handler);
      player.off('sessionchange',sessionChange);
      player.off('sourcechange',reset);
      lifecycle?.signal.removeEventListener('abort', destroy);
    };
    lifecycle?.onCleanup(destroy);
    lifecycle?.signal.addEventListener('abort', destroy, { once: true });
    if (lifecycle?.signal.aborted) destroy();
    else {
      player.on('metadata', handler);
      if (hasSession) player.on('sessionchange',sessionChange);
      else player.on('sourcechange',reset);
    }
    return { destroy };
  };
}

/** @deprecated Use MetadataBridge; this alias preserves the public 1.x API. */
export { MetadataBridge as KlvBridge };
/** @deprecated Use MetadataBridgeOptions. */
export type KlvBridgeOptions<T = unknown> = MetadataBridgeOptions<T>;
