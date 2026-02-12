# Engine Adapters (URL -> Fyra Source)

## Purpose
Convert engine-specific publish URLs/config into Fyra `Source` lists (with fallbacks), so the player can auto-select techs and apply its reconnect/fallback logic.

## Where to put
- `src/plugins/engines/engineFactory.ts` for the factory entry.
- `src/plugins/engines/` for individual engine implementations.

## Reuse from livepano
- Built-in helpers migrated from `ref/livepano` are available under `src/plugins/engines/` (zlm/srs/mediamtx/monibuca/oven/tencent).
- Call `registerDefaultEngines()` if you want them registered (core does not auto-register).
- Adjust outputs to match Fyra `Source` shape, e.g.:
  - webrtc: `{ type: 'webrtc', url, signal: {...} }`
  - ws-flv/http-flv: `{ type: 'ws-raw', url, codec: 'h264', transport: 'flv' }`
  - hls/dash: `{ type: 'hls' | 'dash', url }`
  - fallbackChain: set `techOrder` or provide `fallbacks` on the Source.

## Usage sketch
```ts
import { EngineFactory, registerDefaultEngines } from 'fyraplayer/plugins/engines';
registerDefaultEngines();

const urls = EngineFactory.convertUrl('mediamtx', 'rtsp://host/app/stream');
const sources = [
  { type: 'webrtc', url: urls.webrtcUrl, signal: { type: 'whep', url: urls.whepUrl } },
  { type: 'ws-raw', url: urls.wsFlvUrl, codec: 'h264', transport: 'flv' },
  { type: 'hls', url: urls.hlsUrl }
];
const techOrder = urls.fallbackChain || ['webrtc','ws-raw','hls'];
```

## Notes
- Keep adapters decoupled from player internals; they only emit `Source` objects and optional `techOrder`.
- Do not reimplement fallback logic in adapters; rely on Fyra core tech selection and reconnect policy.
- Register your engines at startup:
  ```ts
  registerDefaultEngines(); // or registerEngine manually
  EngineFactory.setConfig({ mediamtx: { host: '...', ... } });
  ```
- Treat engines as optional: keep engine implementations in a separate folder/package or tree-shakable entry so you don't bloat the core bundle. Core does not ship any engines by default.
