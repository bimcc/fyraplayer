/**
 * FyraPlayer Main Entry Point
 * 
 * Core modules are exported here. For optional plugins (PSV, Cesium, engines),
 * import from 'fyra/plugins' or './plugins/index.js' for tree-shaking.
 */

// Types
export * from './types.js';

// Player
export * from './player.js';

// Core modules
export * from './core/eventBus.js';
export * from './core/middleware.js';
export * from './core/techManager.js';
export * from './core/defaults.js';

// Techs
export * from './techs/tech-webrtc.js';
export * from './techs/tech-hls.js';
export * from './techs/tech-dash.js';
export * from './techs/tech-fmp4.js';
export * from './techs/tech-ws-raw.js';
export * from './techs/tech-gb28181.js';
export * from './techs/tech-file.js';

// Legacy export for backwards compatibility
export { HLSTech as HLSDASHTech } from './techs/tech-hls.js';

// Utils
export * from './utils/webcodecs.js';
export * from './utils/formatDetector.js';

// Render
export * from './render/canvasFrameBuffer.js';
export * from './render/baseTarget.js';

// UI (default, can be disabled via ui: false)
export * from './ui/index.js';
