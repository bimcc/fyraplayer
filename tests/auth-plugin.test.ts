import {
  createAuthRecoveryPlugin,
  createAuthSigningMiddleware,
  defaultAuthRecoveryMatcher,
  getAuthRecoveryStatus,
} from '../src/plugins/auth.js';
import { FyraPlayer } from '../src/player.js';
import { mockTechInstances, resetMockTechInstances } from './mocks/tech-base.js';
import type { EventBusLike, MiddlewareContext, PlayerAPI, PluginContext, Source, TechName } from '../src/types.js';

function makeCtx(): MiddlewareContext {
  return {
    source: { type: 'hls', url: 'https://example.com/live.m3u8' },
    tech: 'hls',
    url: 'https://example.com/live.m3u8',
  };
}

function createVideoStub(): HTMLVideoElement {
  return {
    autoplay: false,
    muted: false,
    preload: 'none',
    src: '',
    srcObject: null,
    load: () => {},
    play: async () => {},
    pause: () => {},
    paused: false,
    currentTime: 0,
    readyState: 0,
    error: null,
  } as unknown as HTMLVideoElement;
}

class BusStub implements EventBusLike {
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, listener: (...args: unknown[]) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }

  once(event: string, listener: (...args: unknown[]) => void): void {
    const onceListener = (...args: unknown[]) => {
      this.off(event, onceListener);
      listener(...args);
    };
    this.on(event, onceListener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      return;
    }
    this.listeners.clear();
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
}

class PlayerStub implements Partial<PlayerAPI> {
  public readonly switchSource = jest.fn(async (_index: number) => undefined);
  public source: Source = { type: 'hls', url: 'https://example.com/live.m3u8' };
  public sources: Source[] = [this.source];

  getSources(): Source[] {
    return this.sources;
  }

  getCurrentSource(): Source | undefined {
    return this.source;
  }
}

function createPluginContext(player: Partial<PlayerAPI>, bus: BusStub): PluginContext {
  return {
    player: player as PlayerAPI,
    coreBus: bus,
    techs: {
      getCurrentTech: () => null,
      getTech: () => null,
      getCurrentTechName: () => 'hls' as TechName,
      getRegisteredTechs: () => ['hls'] as TechName[],
      register: () => ({
        name: 'hls' as TechName,
        unregister: async () => undefined,
      }),
    },
  };
}

describe('createAuthSigningMiddleware', () => {
  beforeEach(() => {
    resetMockTechInstances();
    (globalThis as any).window = { localStorage: null };
  });

  test('injects token, headers, credentials, signed url, and refreshed headers', async () => {
    const [requestMiddleware] = createAuthSigningMiddleware({
      kinds: ['request'],
      headers: { 'x-app': 'fyra' },
      credentials: 'include',
      token: async () => ({ token: 'token-1', expiresAt: 123 }),
      signUrl: ({ url, headers }) => `${url}?signed=${headers.Authorization}`,
      refreshHeaders: ({ url }) => ({ 'x-signed-url': url }),
    });

    const result = await requestMiddleware.fn(makeCtx());

    expect(result).toEqual(
      expect.objectContaining({
        url: 'https://example.com/live.m3u8?signed=Bearer token-1',
        headers: {
          'x-app': 'fyra',
          Authorization: 'Bearer token-1',
          'x-signed-url': 'https://example.com/live.m3u8?signed=Bearer token-1',
        },
        credentials: 'include',
        source: expect.objectContaining({
          url: 'https://example.com/live.m3u8?signed=Bearer token-1',
          request: {
            headers: {
              'x-app': 'fyra',
              Authorization: 'Bearer token-1',
              'x-signed-url': 'https://example.com/live.m3u8?signed=Bearer token-1',
            },
            credentials: 'include',
          },
        }),
      })
    );
  });

  test('can use a raw token header without bearer prefix', async () => {
    const [requestMiddleware] = createAuthSigningMiddleware({
      kinds: ['request'],
      token: 'raw-token',
      tokenHeader: 'x-token',
      tokenPrefix: '',
    });

    const result = await requestMiddleware.fn(makeCtx());

    expect(result?.headers).toEqual({ 'x-token': 'raw-token' });
  });

  test('passes request configuration from middleware into the loaded source', async () => {
    const player = new FyraPlayer({
      video: createVideoStub(),
      sources: [{ type: 'hls', url: 'https://origin/live.m3u8' }],
      techOrder: ['hls'],
      middleware: createAuthSigningMiddleware({
        kinds: ['request'],
        headers: { 'x-project': 'demo' },
        credentials: 'include',
        token: 'token-2',
        signUrl: ({ url }) => `${url}?sig=1`,
      }),
    });

    await player.init();

    const hlsTech = mockTechInstances.hls[0];
    expect((hlsTech.lastLoadedSource as any).url).toBe('https://origin/live.m3u8?sig=1');
    expect((hlsTech.lastLoadedSource as any).request).toEqual({
      headers: {
        'x-project': 'demo',
        Authorization: 'Bearer token-2',
      },
      credentials: 'include',
    });

    await player.destroy();
  });
});

describe('createAuthRecoveryPlugin', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('matches explicit 401/403 payloads and reloads the current source after refresh', async () => {
    const bus = new BusStub();
    const player = new PlayerStub();
    const refresh = jest.fn(async () => undefined);
    const recoveryEvents: string[] = [];
    const networkEvents: unknown[] = [];

    bus.on('network', (event) => networkEvents.push(event));
    createAuthRecoveryPlugin({
      refresh,
      cooldownMs: 0,
      onRecovery: (event) => recoveryEvents.push(event.phase),
    })(createPluginContext(player, bus));

    bus.emit('network', { type: 'whep-http-error', status: 401, fatal: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(player.switchSource).toHaveBeenCalledWith(0);
    expect(recoveryEvents).toEqual(['attempt', 'success']);
    expect(networkEvents).toEqual([
      { type: 'whep-http-error', status: 401, fatal: true },
      expect.objectContaining({
        type: 'auth-recovery-attempt',
        code: 'AUTH_RECOVERY_ATTEMPT',
        attempt: 1,
        maxRetries: 1,
        sourceIndex: 0,
        status: 401,
      }),
      expect.objectContaining({
        type: 'auth-recovery-success',
        code: 'AUTH_RECOVERY_SUCCESS',
        sourceIndex: 0,
        status: 401,
      }),
    ]);
  });

  test('does not treat non-auth network errors as token expiry by default', async () => {
    const bus = new BusStub();
    const player = new PlayerStub();
    const refresh = jest.fn();

    createAuthRecoveryPlugin({ refresh })(createPluginContext(player, bus));

    bus.emit('network', { type: 'hls-fatal', status: 500, fatal: true });
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
    expect(player.switchSource).not.toHaveBeenCalled();
  });

  test('supports custom matchers, cooldown, max retries, and reset on ready', async () => {
    jest.useFakeTimers();
    const bus = new BusStub();
    const player = new PlayerStub();
    const skippedReasons: Array<string | undefined> = [];

    createAuthRecoveryPlugin({
      maxRetries: 1,
      cooldownMs: 1000,
      match: (trigger) => trigger === 'expired-token',
      onRecovery: (event) => {
        if (event.phase === 'skipped' || event.phase === 'failed') skippedReasons.push(event.reason);
      },
    })(createPluginContext(player, bus));

    bus.emit('error', 'expired-token');
    await Promise.resolve();
    await Promise.resolve();

    bus.emit('error', 'expired-token');
    await Promise.resolve();
    expect(skippedReasons).toEqual(['cooldown']);

    await jest.advanceTimersByTimeAsync(1000);
    bus.emit('error', 'expired-token');
    await Promise.resolve();
    expect(skippedReasons).toEqual(['cooldown', 'max-retries']);

    bus.emit('ready');
    bus.emit('error', 'expired-token');
    await Promise.resolve();
    await Promise.resolve();

    expect(player.switchSource).toHaveBeenCalledTimes(2);
  });

  test('detaches listeners on destroy', async () => {
    const bus = new BusStub();
    const player = new PlayerStub();
    const refresh = jest.fn();
    const lifecycle = createAuthRecoveryPlugin({ refresh, cooldownMs: 0 })(createPluginContext(player, bus));

    lifecycle?.destroy?.();
    bus.emit('network', { status: 401 });
    await Promise.resolve();

    expect(refresh).not.toHaveBeenCalled();
    expect(player.switchSource).not.toHaveBeenCalled();
  });

  test('extracts nested auth status for default matching helpers', () => {
    expect(getAuthRecoveryStatus({ response: { status: 403 } })).toBe(403);
    expect(defaultAuthRecoveryMatcher({ error: { statusCode: 401 } })).toBe(true);
    expect(defaultAuthRecoveryMatcher({ status: 500 })).toBe(false);
  });
});
