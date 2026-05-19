import type {
  PlayerRecordingCode,
  PlayerRecordingErrorInfo,
  PlayerRecordingEvent,
  PlayerRecordingStatus,
  PluginCtor,
  Source,
  TechName,
} from '../types.js';

export interface RecordingApiContext {
  action: 'start' | 'stop' | 'status';
  endpoint: string;
  source?: Source;
  sourceIndex: number;
  tech?: TechName | null;
  recordingId?: string;
  sessionId?: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface RecordingApiResponse {
  recordingId?: string;
  sessionId?: string;
  status?: PlayerRecordingStatus | 'started' | 'stopped';
  active?: boolean;
  [key: string]: unknown;
}

export class RecordingApiError extends Error {
  readonly info: PlayerRecordingErrorInfo;

  constructor(info: PlayerRecordingErrorInfo) {
    super(info.message);
    this.name = 'RecordingApiError';
    this.info = info;
  }
}

export interface RecordingApiHandle {
  start(extraBody?: unknown): Promise<RecordingApiResponse>;
  stop(extraBody?: unknown): Promise<RecordingApiResponse>;
  status(): Promise<RecordingApiResponse | undefined>;
  isRecording(): boolean;
  getRecordingId(): string | undefined;
  destroy(): void;
}

export interface RecordingApiPluginOptions {
  /** Endpoint used to start recording. */
  startUrl: string | ((ctx: RecordingApiContext) => string | Promise<string>);
  /** Endpoint used to stop recording. Defaults to startUrl when omitted. */
  stopUrl?: string | ((ctx: RecordingApiContext) => string | Promise<string>);
  /** Optional endpoint used to query server-side recording state. */
  statusUrl?: string | ((ctx: RecordingApiContext) => string | Promise<string>);
  /** HTTP method for start. Defaults to POST. */
  startMethod?: string;
  /** HTTP method for stop. Defaults to POST. */
  stopMethod?: string;
  /** HTTP method for status. Defaults to GET. */
  statusMethod?: string;
  /** Static or dynamic headers for every recording API call. */
  headers?: Record<string, string> | ((ctx: RecordingApiContext) => Record<string, string> | Promise<Record<string, string>>);
  /** Credentials policy for recording API fetch calls. */
  credentials?: RequestCredentials;
  /** Request timeout for recording API calls. Defaults to 10000ms. */
  timeoutMs?: number;
  /** Build the request body sent to the backend. Defaults to source/session metadata. */
  buildBody?: (ctx: RecordingApiContext) => unknown | Promise<unknown>;
  /** Parse backend responses. Defaults to JSON when possible, then text. */
  parseResponse?: (response: Response, ctx: RecordingApiContext) => RecordingApiResponse | Promise<RecordingApiResponse>;
  /** Maximum response body characters kept on non-2xx errors. Defaults to 512. */
  maxErrorBodyLength?: number;
  /** Receives the imperative handle so UI/product code can call start/stop. */
  onHandle?: (handle: RecordingApiHandle) => void;
  /** Called after every recording event. */
  onEvent?: (event: PlayerRecordingEvent) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeStatus(value: unknown, fallback: PlayerRecordingStatus): PlayerRecordingStatus {
  if (
    value === 'idle' ||
    value === 'starting' ||
    value === 'recording' ||
    value === 'stopping' ||
    value === 'stopped' ||
    value === 'error'
  ) {
    return value;
  }
  if (value === 'started') return 'recording';
  if (value === 'stopped') return 'stopped';
  return fallback;
}

function mergeBody(base: unknown, extra: unknown): unknown {
  if (extra === undefined) return base;
  if (isRecord(base) && isRecord(extra)) return { ...base, ...extra };
  return extra;
}

async function defaultParseResponse(response: Response): Promise<RecordingApiResponse> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as RecordingApiResponse;
  }
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as RecordingApiResponse;
  } catch {
    return { message: text };
  }
}

async function parseErrorBody(response: Response, maxLength: number): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    const text = await response.text();
    if (!text) return undefined;
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function createRecordingError(info: Omit<PlayerRecordingErrorInfo, 'message'> & { message?: string }): RecordingApiError {
  const message = info.message ?? buildRecordingErrorMessage(info);
  return new RecordingApiError({ ...info, message });
}

function buildRecordingErrorMessage(info: Omit<PlayerRecordingErrorInfo, 'message'>): string {
  const action = info.action ?? 'request';
  switch (info.code) {
    case 'RECORDING_HTTP_ERROR':
      return `Recording ${action} failed: HTTP ${info.status ?? 'unknown'}`;
    case 'RECORDING_TIMEOUT':
      return `Recording ${action} timed out after ${info.timeoutMs ?? 'unknown'}ms`;
    case 'RECORDING_ABORTED':
      return `Recording ${action} was aborted`;
    case 'RECORDING_PARSE_ERROR':
      return `Recording ${action} response parse failed`;
    case 'RECORDING_CONFIG_ERROR':
      return `Recording ${action} is not configured`;
    case 'RECORDING_REQUEST_ERROR':
    default:
      return `Recording ${action} request failed`;
  }
}

function toRecordingErrorInfo(error: unknown): PlayerRecordingErrorInfo {
  if (error instanceof RecordingApiError) return error.info;
  if (error instanceof Error) {
    return {
      code: 'RECORDING_REQUEST_ERROR',
      message: error.message,
      cause: error,
    };
  }
  return {
    code: 'RECORDING_REQUEST_ERROR',
    message: String(error),
    cause: error,
  };
}

export function createRecordingApiPlugin(options: RecordingApiPluginOptions): PluginCtor {
  return ({ coreBus, player, techs }) => {
    let active = false;
    let status: PlayerRecordingStatus = 'idle';
    let recordingId: string | undefined;
    let sessionId: string | undefined;
    let destroyed = false;
    let inFlight: AbortController | null = null;

    const getSourceIndex = (): number => {
      const source = player.getCurrentSource();
      return source ? player.getSources().indexOf(source) : -1;
    };

    const makeBaseContext = (action: RecordingApiContext['action'], endpoint = ''): RecordingApiContext => ({
      action,
      endpoint,
      source: player.getCurrentSource(),
      sourceIndex: getSourceIndex(),
      tech: techs.getCurrentTechName(),
      recordingId,
      sessionId,
      headers: {},
    });

    const emit = (
      type: PlayerRecordingEvent['type'],
      nextStatus: PlayerRecordingStatus,
      response?: unknown,
      error?: unknown
    ): PlayerRecordingEvent => {
      const errorInfo = error === undefined ? undefined : toRecordingErrorInfo(error);
      status = nextStatus;
      active = status === 'recording' || status === 'starting';
      const event: PlayerRecordingEvent = {
        type,
        status,
        active,
        source: player.getCurrentSource(),
        sourceIndex: getSourceIndex(),
        tech: techs.getCurrentTechName(),
        recordingId,
        sessionId,
        response,
        error: errorInfo,
        code: errorInfo?.code,
        ts: Date.now(),
      };
      coreBus.emit('recording', event);
      options.onEvent?.(event);
      return event;
    };

    const resolveEndpoint = async (
      action: RecordingApiContext['action'],
      value: RecordingApiPluginOptions['startUrl'] | undefined
    ): Promise<string> => {
      if (!value) {
        throw createRecordingError({
          code: 'RECORDING_CONFIG_ERROR',
          action,
        });
      }
      const ctx = makeBaseContext(action);
      return typeof value === 'function' ? value(ctx) : value;
    };

    const resolveHeaders = async (ctx: RecordingApiContext): Promise<Record<string, string>> => {
      const headers = typeof options.headers === 'function'
        ? await options.headers(ctx)
        : options.headers;
      return {
        'Content-Type': 'application/json',
        ...headers,
      };
    };

    const buildDefaultBody = (ctx: RecordingApiContext): Record<string, unknown> => ({
      source: ctx.source,
      sourceIndex: ctx.sourceIndex,
      tech: ctx.tech,
      recordingId: ctx.recordingId,
      sessionId: ctx.sessionId,
    });

    const request = async (
      action: RecordingApiContext['action'],
      endpoint: string,
      method: string,
      extraBody?: unknown
    ): Promise<RecordingApiResponse> => {
      if (destroyed) {
        throw createRecordingError({
          code: 'RECORDING_CONFIG_ERROR',
          action,
          endpoint,
          message: 'Recording plugin has been destroyed',
        });
      }
      inFlight?.abort();
      const controller = new AbortController();
      inFlight = controller;
      const timeoutMs = options.timeoutMs ?? 10000;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const ctx = makeBaseContext(action, endpoint);
      const headers = await resolveHeaders(ctx);
      const defaultBody = options.buildBody
        ? await options.buildBody({ ...ctx, headers })
        : buildDefaultBody({ ...ctx, headers });
      const body = method.toUpperCase() === 'GET'
        ? undefined
        : JSON.stringify(mergeBody(defaultBody, extraBody));
      try {
        const response = await fetch(endpoint, {
          method,
          headers,
          body,
          credentials: options.credentials,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw createRecordingError({
            code: 'RECORDING_HTTP_ERROR',
            action,
            endpoint,
            status: response.status,
            statusText: response.statusText,
            body: await parseErrorBody(response, options.maxErrorBodyLength ?? 512),
          });
        }
        try {
          return options.parseResponse
            ? await options.parseResponse(response, { ...ctx, headers, body })
            : await defaultParseResponse(response);
        } catch (error) {
          throw createRecordingError({
            code: 'RECORDING_PARSE_ERROR',
            action,
            endpoint,
            cause: error,
          });
        }
      } catch (error) {
        if (isAbortError(error)) {
          throw createRecordingError({
            code: timedOut ? 'RECORDING_TIMEOUT' : 'RECORDING_ABORTED',
            action,
            endpoint,
            timeoutMs,
            cause: error,
          });
        }
        if (error instanceof RecordingApiError) throw error;
        throw createRecordingError({
          code: 'RECORDING_REQUEST_ERROR',
          action,
          endpoint,
          cause: error,
          message: error instanceof Error ? error.message : undefined,
        });
      } finally {
        clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
      }
    };

    const applyResponseState = (response: RecordingApiResponse, fallback: PlayerRecordingStatus): PlayerRecordingStatus => {
      recordingId = typeof response.recordingId === 'string' ? response.recordingId : recordingId;
      sessionId = typeof response.sessionId === 'string' ? response.sessionId : sessionId;
      if (typeof response.active === 'boolean') {
        return response.active ? 'recording' : 'stopped';
      }
      return normalizeStatus(response.status, fallback);
    };

    const handle: RecordingApiHandle = {
      async start(extraBody?: unknown) {
        emit('recording-starting', 'starting');
        try {
          const endpoint = await resolveEndpoint('start', options.startUrl);
          const response = await request('start', endpoint, options.startMethod ?? 'POST', extraBody);
          emit('recording-started', applyResponseState(response, 'recording'), response);
          return response;
        } catch (error) {
          emit('recording-error', 'error', undefined, error);
          throw error;
        }
      },
      async stop(extraBody?: unknown) {
        emit('recording-stopping', 'stopping');
        try {
          const endpoint = await resolveEndpoint('stop', options.stopUrl ?? options.startUrl);
          const response = await request('stop', endpoint, options.stopMethod ?? 'POST', extraBody);
          emit('recording-stopped', applyResponseState(response, 'stopped'), response);
          return response;
        } catch (error) {
          emit('recording-error', 'error', undefined, error);
          throw error;
        }
      },
      async status() {
        if (!options.statusUrl) return undefined;
        const endpoint = await resolveEndpoint('status', options.statusUrl);
        const response = await request('status', endpoint, options.statusMethod ?? 'GET');
        emit('recording-status', applyResponseState(response, status), response);
        return response;
      },
      isRecording: () => active,
      getRecordingId: () => recordingId,
      destroy: () => {
        destroyed = true;
        inFlight?.abort();
        inFlight = null;
      },
    };

    options.onHandle?.(handle);

    return {
      destroy: handle.destroy,
    };
  };
}
