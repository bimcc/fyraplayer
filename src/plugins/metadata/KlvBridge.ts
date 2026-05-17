import type { MetadataDetectedEvent, MetadataEvent, PluginCtor } from '../../types.js';

/**
 * Generic bridge: takes Fyra metadata events (raw private-data/SEI payloads)
 * and hands them to an external parser (e.g., @beeviz/klv) before invoking a consumer callback.
 */
export interface KlvBridgeOptions<T = unknown> {
  /** Parser that converts a MetadataEvent into a typed result (sync or async). */
  parse: (event: MetadataEvent) => Promise<T> | T;
  /** Callback to receive parsed/normalized metadata (e.g., attitude/position/pts). */
  onData: (parsed: T, raw: MetadataEvent) => void;
  /** Optional error handler for parser failures. */
  onError?: (error: unknown, raw: MetadataEvent) => void;
}

export class KlvBridge<T = unknown> {
  constructor(private readonly opts: KlvBridgeOptions<T>) {}

  async handle(event: MetadataEvent): Promise<void> {
    try {
      const parsed = await this.opts.parse(event);
      this.opts.onData(parsed, event);
    } catch (err) {
      this.opts.onError?.(err, event);
    }
  }
}

export interface MetadataPluginOptions<T = unknown> extends KlvBridgeOptions<T> {
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
 * (KLV/MISB/SEI/private data semantics) belongs here or in an application
 * plugin so the stable player contract stays parser-agnostic.
 */
export function createMetadataPlugin<T = unknown>(opts: MetadataPluginOptions<T>): PluginCtor {
  return ({ player }) => {
    const bridge = new KlvBridge<T>(opts);
    const handler = (event: MetadataEvent | MetadataDetectedEvent) => {
      if (isRawMetadataEvent(event)) {
        void bridge.handle(event);
        return;
      }
      opts.onDetected?.(event);
    };

    player.on('metadata', handler);

    return {
      destroy: () => {
        player.off('metadata', handler);
      }
    };
  };
}
