import { MiddlewareEntry, MiddlewareKind, MiddlewareContext, MiddlewareResult } from '../types.js';

const CONTROL_TIMEOUT_MS = 2000;

export class MiddlewareManager {
  private chains: Map<MiddlewareKind, MiddlewareEntry[]> = new Map();

  use(entry: MiddlewareEntry): void {
    if (!this.chains.has(entry.kind)) {
      this.chains.set(entry.kind, []);
    }
    this.chains.get(entry.kind)!.push(entry);
  }

  async run(kind: MiddlewareKind, ctx: MiddlewareContext): Promise<MiddlewareContext> {
    const chain = this.chains.get(kind) ?? [];
    let acc: MiddlewareContext = { ...ctx };
    for (const entry of chain) {
      const res = await this.execute(entry, kind, acc);
      if (res) acc = { ...acc, ...res };
    }
    return acc;
  }

  private async execute(entry: MiddlewareEntry, kind: MiddlewareKind, ctx: MiddlewareContext): Promise<MiddlewareResult | void> {
    if (kind !== 'control') {
      return entry.fn(ctx);
    }
    const timeoutMs = entry.timeoutMs ?? CONTROL_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        entry.fn(ctx),
        new Promise<MiddlewareResult | void>((resolve) => {
          timer = setTimeout(() => resolve(undefined), timeoutMs);
        })
      ]);
      return res;
    } catch (err) {
      // 控制中间件失败时不中断流程，透传
      console.warn('[middleware] control middleware error, bypass', err);
      return;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
