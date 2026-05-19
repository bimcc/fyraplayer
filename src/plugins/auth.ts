import type {
  MiddlewareContext,
  MiddlewareEntry,
  MiddlewareKind,
  MiddlewareResult,
  PlayerNetworkEvent,
  PluginCtor,
  Source,
} from '../types.js';

export interface AuthTokenResult {
  token: string;
  expiresAt?: number;
}

export interface AuthSigningContext {
  kind: MiddlewareKind;
  source: Source;
  tech: string;
  url: string;
  headers: Record<string, string>;
  credentials?: RequestCredentials;
}

export interface AuthSigningPluginOptions {
  /** Middleware stages where auth should run. Defaults to request + signal. */
  kinds?: Array<'request' | 'signal'>;
  /** Static headers merged before token/signing logic. */
  headers?: Record<string, string>;
  /** Static credentials policy for Techs that support request credentials. */
  credentials?: RequestCredentials;
  /** Static bearer token or async token provider. */
  token?: string | (() => string | AuthTokenResult | Promise<string | AuthTokenResult>);
  /** Header name for bearer token injection. Defaults to Authorization. */
  tokenHeader?: string;
  /** Prefix for token value. Defaults to Bearer. Set empty string for raw token. */
  tokenPrefix?: string;
  /** Optional URL signing hook. */
  signUrl?: (ctx: AuthSigningContext) => string | Promise<string>;
  /** Optional header refresh hook after token/signing logic. */
  refreshHeaders?: (ctx: AuthSigningContext) => Record<string, string> | Promise<Record<string, string>>;
  /** Called when token provider returns an expiry timestamp. */
  onTokenRefresh?: (result: AuthTokenResult) => void;
}

export type AuthRecoveryTriggerType = 'network' | 'error';
export type AuthRecoveryPhase = 'attempt' | 'success' | 'failed' | 'skipped';

export interface AuthRecoveryMatchContext {
  triggerType: AuthRecoveryTriggerType;
  source?: Source;
  sourceIndex: number;
}

export interface AuthRecoveryContext extends AuthRecoveryMatchContext {
  trigger: unknown;
  attempt: number;
  maxRetries: number;
}

export interface AuthRecoveryEvent extends AuthRecoveryContext {
  phase: AuthRecoveryPhase;
  ts: number;
  reason?: string;
  error?: unknown;
  status?: number;
}

export interface AuthRecoveryPluginOptions {
  /**
   * Match an auth-expired trigger. Defaults to explicit HTTP 401/403 only.
   * Use this to match product-specific network/error payloads.
   */
  match?: (trigger: unknown, context: AuthRecoveryMatchContext) => boolean;
  /** Refresh product-owned auth state before the current source is reloaded. */
  refresh?: (context: AuthRecoveryContext) => void | Promise<void>;
  /** Maximum recovery attempts before the next `ready` event resets the counter. Defaults to 1. */
  maxRetries?: number;
  /** Minimum time between recovery attempts. Defaults to 5000ms. */
  cooldownMs?: number;
  /** Called for attempt/success/failed/skipped lifecycle events. */
  onRecovery?: (event: AuthRecoveryEvent) => void;
}

function normalizeToken(value: string | AuthTokenResult): AuthTokenResult {
  return typeof value === 'string' ? { token: value } : value;
}

function formatTokenValue(token: string, prefix: string): string {
  return prefix ? `${prefix} ${token}` : token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuthRecoveryNetworkEvent(value: unknown): boolean {
  return isRecord(value) && typeof value.type === 'string' && value.type.startsWith('auth-recovery-');
}

function readStatusFromRecord(value: Record<string, unknown>, visited: Set<unknown>): number | undefined {
  const directKeys = ['status', 'statusCode', 'responseCode', 'httpStatus'];
  for (const key of directKeys) {
    const status = value[key];
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }

  const nestedKeys = ['response', 'networkDetails', 'error', 'cause'];
  for (const key of nestedKeys) {
    const nested = value[key];
    const status = getAuthRecoveryStatus(nested, visited);
    if (status !== undefined) return status;
  }
  return undefined;
}

export function getAuthRecoveryStatus(trigger: unknown, visited: Set<unknown> = new Set()): number | undefined {
  if (trigger === undefined || trigger === null || visited.has(trigger)) return undefined;
  if (isRecord(trigger)) {
    visited.add(trigger);
    return readStatusFromRecord(trigger, visited);
  }
  return undefined;
}

export function defaultAuthRecoveryMatcher(trigger: unknown): boolean {
  const status = getAuthRecoveryStatus(trigger);
  return status === 401 || status === 403;
}

async function runAuth(
  kind: MiddlewareKind,
  ctx: MiddlewareContext,
  options: AuthSigningPluginOptions
): Promise<MiddlewareResult> {
  const url = ctx.url ?? ctx.source.url;
  let headers: Record<string, string> = {
    ...ctx.source.request?.headers,
    ...ctx.headers,
    ...options.headers,
  };
  const credentials = options.credentials ?? ctx.credentials ?? ctx.source.request?.credentials;

  if (options.token) {
    const rawToken = typeof options.token === 'function' ? await options.token() : options.token;
    const tokenResult = normalizeToken(rawToken);
    if (tokenResult.token) {
      const tokenHeader = options.tokenHeader ?? 'Authorization';
      const tokenPrefix = options.tokenPrefix ?? 'Bearer';
      headers[tokenHeader] = formatTokenValue(tokenResult.token, tokenPrefix);
    }
    if (tokenResult.expiresAt !== undefined) {
      options.onTokenRefresh?.(tokenResult);
    }
  }

  const signingContext: AuthSigningContext = {
    kind,
    source: ctx.source,
    tech: ctx.tech,
    url,
    headers,
    credentials,
  };

  const signedUrl = options.signUrl ? await options.signUrl(signingContext) : url;
  const refreshedHeaders = options.refreshHeaders
    ? await options.refreshHeaders({ ...signingContext, url: signedUrl, headers })
    : undefined;
  if (refreshedHeaders) {
    headers = { ...headers, ...refreshedHeaders };
  }

  return {
    url: signedUrl,
    headers,
    credentials,
    source: {
      ...ctx.source,
      url: signedUrl,
      request: {
        ...ctx.source.request,
        headers,
        credentials,
      },
    } as Source,
  };
}

export function createAuthSigningMiddleware(options: AuthSigningPluginOptions): MiddlewareEntry[] {
  const kinds = options.kinds ?? ['request', 'signal'];
  return kinds.map((kind) => ({
    kind,
    fn: (ctx) => runAuth(kind, ctx, options),
  }));
}

function getCurrentSourceIndex(sources: Source[], source: Source | undefined): number {
  return source ? sources.indexOf(source) : -1;
}

function toNetworkEvent(
  type: 'auth-recovery-attempt' | 'auth-recovery-success' | 'auth-recovery-failed' | 'auth-recovery-skipped',
  event: AuthRecoveryEvent
): PlayerNetworkEvent {
  const codeByType = {
    'auth-recovery-attempt': 'AUTH_RECOVERY_ATTEMPT',
    'auth-recovery-success': 'AUTH_RECOVERY_SUCCESS',
    'auth-recovery-failed': 'AUTH_RECOVERY_FAILED',
    'auth-recovery-skipped': 'AUTH_RECOVERY_SKIPPED',
  } as const;
  const messageByType = {
    'auth-recovery-attempt': `Auth recovery attempt ${event.attempt}/${event.maxRetries}`,
    'auth-recovery-success': 'Auth recovery reloaded the current source',
    'auth-recovery-failed': `Auth recovery failed${event.reason ? `: ${event.reason}` : ''}`,
    'auth-recovery-skipped': `Auth recovery skipped${event.reason ? `: ${event.reason}` : ''}`,
  };
  return {
    type,
    code: codeByType[type],
    severity: type === 'auth-recovery-attempt' || type === 'auth-recovery-success' ? 'info' : 'warning',
    message: messageByType[type],
    attempt: event.attempt,
    maxRetries: event.maxRetries,
    sourceIndex: event.sourceIndex,
    sourceType: event.source?.type,
    status: event.status,
    reason: event.reason,
    triggerType: event.triggerType,
    error: event.error,
  };
}

export function createAuthRecoveryPlugin(options: AuthRecoveryPluginOptions = {}): PluginCtor {
  return ({ coreBus, player }) => {
    const maxRetries = Math.max(0, options.maxRetries ?? 1);
    const cooldownMs = Math.max(0, options.cooldownMs ?? 5000);
    const match = options.match ?? ((trigger: unknown) => defaultAuthRecoveryMatcher(trigger));
    let attempts = 0;
    let inFlight = false;
    let destroyed = false;
    let lastAttemptAt: number | undefined;

    const emitRecovery = (
      phase: AuthRecoveryPhase,
      context: AuthRecoveryContext,
      reason?: string,
      error?: unknown
    ): void => {
      const event: AuthRecoveryEvent = {
        ...context,
        phase,
        reason,
        error,
        status: getAuthRecoveryStatus(context.trigger),
        ts: Date.now(),
      };
      options.onRecovery?.(event);
      const typeByPhase = {
        attempt: 'auth-recovery-attempt',
        success: 'auth-recovery-success',
        failed: 'auth-recovery-failed',
        skipped: 'auth-recovery-skipped',
      } as const;
      coreBus.emit('network', toNetworkEvent(typeByPhase[phase], event));
    };

    const getMatchContext = (triggerType: AuthRecoveryTriggerType): AuthRecoveryMatchContext => {
      const source = player.getCurrentSource();
      return {
        triggerType,
        source,
        sourceIndex: getCurrentSourceIndex(player.getSources(), source),
      };
    };

    const recover = async (trigger: unknown, baseContext: AuthRecoveryMatchContext): Promise<void> => {
      if (destroyed) return;
      if (baseContext.sourceIndex < 0) {
        emitRecovery('skipped', { ...baseContext, trigger, attempt: attempts, maxRetries }, 'no-current-source');
        return;
      }
      if (inFlight) {
        emitRecovery('skipped', { ...baseContext, trigger, attempt: attempts, maxRetries }, 'in-flight');
        return;
      }
      const now = Date.now();
      if (lastAttemptAt !== undefined && now - lastAttemptAt < cooldownMs) {
        emitRecovery('skipped', { ...baseContext, trigger, attempt: attempts, maxRetries }, 'cooldown');
        return;
      }
      if (attempts >= maxRetries) {
        emitRecovery('failed', { ...baseContext, trigger, attempt: attempts, maxRetries }, 'max-retries');
        return;
      }

      attempts += 1;
      lastAttemptAt = now;
      inFlight = true;
      const context: AuthRecoveryContext = {
        ...baseContext,
        trigger,
        attempt: attempts,
        maxRetries,
      };
      emitRecovery('attempt', context);

      try {
        await options.refresh?.(context);
        if (destroyed) return;
        const currentSource = player.getCurrentSource();
        const currentSourceIndex = getCurrentSourceIndex(player.getSources(), currentSource);
        if (currentSourceIndex !== context.sourceIndex) {
          emitRecovery('skipped', context, 'source-changed');
          return;
        }
        await player.switchSource(context.sourceIndex);
        if (!destroyed) {
          emitRecovery('success', context);
        }
      } catch (error) {
        if (!destroyed) {
          emitRecovery('failed', context, 'recovery-error', error);
        }
      } finally {
        inFlight = false;
      }
    };

    const handleTrigger = (triggerType: AuthRecoveryTriggerType, trigger: unknown): void => {
      if (destroyed || isAuthRecoveryNetworkEvent(trigger)) return;
      const context = getMatchContext(triggerType);
      if (!match(trigger, context)) return;
      void recover(trigger, context);
    };

    const networkHandler = (event?: unknown) => handleTrigger('network', event);
    const errorHandler = (error?: unknown) => handleTrigger('error', error);
    const readyHandler = () => {
      attempts = 0;
      lastAttemptAt = undefined;
    };

    coreBus.on('network', networkHandler);
    coreBus.on('error', errorHandler);
    coreBus.on('ready', readyHandler);

    return {
      destroy: () => {
        destroyed = true;
        coreBus.off('network', networkHandler);
        coreBus.off('error', errorHandler);
        coreBus.off('ready', readyHandler);
      },
    };
  };
}
