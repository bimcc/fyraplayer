import { MiddlewareManager } from '../src/core/middleware.js';
import type { MiddlewareContext } from '../src/types.js';

function makeCtx(): MiddlewareContext {
  return {
    source: { type: 'hls', url: 'https://example.com/a.m3u8' },
    tech: 'hls',
    url: 'https://example.com/a.m3u8'
  };
}

describe('MiddlewareManager', () => {
  test('merges request middleware results in order', async () => {
    const manager = new MiddlewareManager();
    manager.use({
      kind: 'request',
      fn: () => ({
        url: 'https://example.com/first.m3u8',
        headers: { a: '1' }
      })
    });
    manager.use({
      kind: 'request',
      fn: (ctx) => ({
        url: `${ctx.url}?token=ok`,
        headers: { ...ctx.headers, b: '2' }
      })
    });

    const result = await manager.run('request', makeCtx());

    expect(result.url).toBe('https://example.com/first.m3u8?token=ok');
    expect(result.headers).toEqual({ a: '1', b: '2' });
  });

  test('control middleware timeout bypasses stalled middleware', async () => {
    const manager = new MiddlewareManager();
    manager.use({
      kind: 'control',
      timeoutMs: 20,
      fn: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return { payload: { delayed: true } };
      }
    });
    manager.use({
      kind: 'control',
      fn: () => ({ payload: { ok: true } })
    });

    const result = await manager.run('control', {
      source: { type: 'hls', url: 'https://example.com/a.m3u8' },
      tech: 'hls',
      action: 'play'
    });

    expect(result.payload).toEqual({ ok: true });
  });

  test('control middleware errors are swallowed and chain continues', async () => {
    const manager = new MiddlewareManager();
    manager.use({
      kind: 'control',
      fn: () => {
        throw new Error('boom');
      }
    });
    manager.use({
      kind: 'control',
      fn: () => ({ payload: { still: 'running' } })
    });

    const result = await manager.run('control', {
      source: { type: 'hls', url: 'https://example.com/a.m3u8' },
      tech: 'hls',
      action: 'play'
    });

    expect(result.payload).toEqual({ still: 'running' });
  });
});

