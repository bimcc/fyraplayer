/**
 * FyraPlayer Core Entry Point (Minimal Bundle)
 * 
 * This module exports only the core player functionality without any plugins.
 * Use this for minimal bundle size when you don't need PSV/Cesium/Engine adapters.
 * 
 * Usage:
 *   import { FyraPlayer } from 'fyraplayer/core';
 *   
 * For plugins, import separately:
 *   import { FyraPsvAdapter } from 'fyraplayer/plugins/psv';
 *   import { EngineFactory } from 'fyraplayer/plugins/engines';
 */

// Types
export * from './types.js';

// Core player
export * from './player.js';

// Core modules
export * from './core/eventBus.js';
export * from './core/middleware.js';
export * from './core/techManager.js';
export * from './core/defaults.js';

// Techs (播放技术)
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

// UI (默认启用，可通过 ui: false 关闭)
export * from './ui/index.js';
