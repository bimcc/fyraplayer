import { EngineFactory } from './engineFactory.js';
import { MediaMtxEngine } from './MediaMtxEngine.js';
import { MonibucaEngine } from './MonibucaEngine.js';
import { OvenEngine } from './OvenEngine.js';
import { SrsEngine } from './SrsEngine.js';
import { TencentEngine } from './TencentEngine.js';
import { ZlmEngine } from './ZlmEngine.js';

/**
 * Optional helper to register built-in engines.
 * Call this in your app/startup if you want default engines available.
 * Core does NOT auto-register to avoid extra bundle weight when unused.
 */
export function registerDefaultEngines(): void {
  EngineFactory.registerEngine('mediamtx', (config) => new MediaMtxEngine(config));
  EngineFactory.registerEngine('monibuca', (config) => new MonibucaEngine(config));
  EngineFactory.registerEngine('oven', (config) => new OvenEngine(config));
  EngineFactory.registerEngine('srs', (config) => new SrsEngine(config));
  EngineFactory.registerEngine('tencent', (config) => new TencentEngine(config));
  EngineFactory.registerEngine('zlm', (config) => new ZlmEngine(config));
}

export {
  EngineFactory,
  MediaMtxEngine,
  MonibucaEngine,
  OvenEngine,
  SrsEngine,
  TencentEngine,
  ZlmEngine
};

export type { Engine, EngineUrls, EngineConfig } from './engineFactory.js';
