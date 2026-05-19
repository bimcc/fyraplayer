/**
 * FyraPlayer Plugins Entry Point
 * 
 * All plugins are optional and can be imported separately for tree-shaking.
 * 
 * Usage:
 *   import { EngineFactory, registerDefaultEngines } from 'fyraplayer/plugins/engines';
 *   import { KlvBridge } from 'fyraplayer/plugins/metadata';
 * 
 * Note: PSV and Cesium adapters have been moved to their respective projects:
 *   - PSV adapter: @beeviz/fyrapano
 *   - Cesium adapter: @beeviz/cesium
 */

// Metadata bridge (KLV/MISB)
export {
  KlvBridge,
  createMetadataPlugin,
  type KlvBridgeOptions,
  type MetadataPluginOptions,
} from './metadata/KlvBridge.js';

// Metrics reporter plugin
export {
  createMetricsPlugin,
  type MetricsEventPayload,
  type MetricsPluginOptions,
} from './metrics.js';

// Performance budget monitor plugin
export {
  DEFAULT_PERFORMANCE_BUDGET,
  createPerformanceMonitorPlugin,
  type PerformanceBudget,
  type PerformanceFpsMode,
  type PerformanceMonitorOptions,
  type PerformanceSample,
  type PerformanceViolation,
  type PerformanceViolationCode,
} from './performance.js';

// Storage preference plugin
export {
  createStoragePlugin,
  type StoragePluginOptions,
} from './storage.js';

// Reconnect diagnostics plugin
export {
  createReconnectPlugin,
  type ReconnectPluginOptions,
} from './reconnect.js';

// Backend recording API plugin
export {
  RecordingApiError,
  createRecordingApiPlugin,
  type RecordingApiContext,
  type RecordingApiHandle,
  type RecordingApiPluginOptions,
  type RecordingApiResponse,
} from './recording.js';

// Diagnostics snapshot/export plugin
export {
  createDebugPanelPlugin,
  createDiagnosticsPlugin,
  type DebugPanelPluginOptions,
  type DiagnosticsEventRecord,
  type DiagnosticsEventType,
  type DiagnosticsHandle,
  type DiagnosticsPluginOptions,
  type DiagnosticsSnapshot,
} from './diagnostics.js';

// Auth/signing middleware helpers
export {
  createAuthRecoveryPlugin,
  createAuthSigningMiddleware,
  defaultAuthRecoveryMatcher,
  getAuthRecoveryStatus,
  type AuthRecoveryContext,
  type AuthRecoveryEvent,
  type AuthRecoveryMatchContext,
  type AuthRecoveryPhase,
  type AuthRecoveryPluginOptions,
  type AuthRecoveryTriggerType,
  type AuthSigningContext,
  type AuthSigningPluginOptions,
  type AuthTokenResult,
} from './auth.js';

// Engine adapters (URL conversion for streaming servers)
export {
  EngineFactory,
  registerDefaultEngines,
  MediaMtxEngine,
  MonibucaEngine,
  OvenEngine,
  SrsEngine,
  TencentEngine,
  ZlmEngine,
  createSourceResolverMiddleware,
  engineUrlsToResolvedSources,
  type Engine,
  type EngineUrls,
  type EngineConfig,
  type EngineUrlsToSourcesOptions,
  type SourceResolverMiddlewareOptions,
  type SourceResolverProtocol,
} from './engines/index.js';
