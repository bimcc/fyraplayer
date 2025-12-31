import { MetadataEvent } from '../../types.js';

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
