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
