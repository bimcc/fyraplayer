/**
 * FyraPlayer Plugins Entry Point
 * 
 * All plugins are optional and can be imported separately for tree-shaking.
 * 
 * Usage:
 *   import { FyraPsvAdapter } from 'fyra/plugins';
 *   import { EngineFactory, registerDefaultEngines } from 'fyra/plugins';
 */

// PSV (Photo Sphere Viewer) integration
export { FyraPsvAdapter, type FyraPsvAdapterOptions } from './psv/FyraPsvAdapter.js';
export { createFyraPsvPlugin, registerFyraPsvPlugin } from './psv/plugin.js';

// Cesium 3D integration
export { FyraCesiumAdapter, type FyraCesiumAdapterOptions } from './cesium/FyraCesiumAdapter.js';

// Metadata bridge (KLV/MISB)
export { KlvBridge, type KlvBridgeOptions } from './metadata/KlvBridge.js';

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
  type Engine,
  type EngineUrls,
  type EngineConfig,
} from './engines/index.js';
