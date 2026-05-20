# Engine Adapters (URL -> Fyra Source)

## Purpose
Convert engine-specific publish URLs/config into Fyra `Source` lists (with fallbacks), so the player can auto-select techs and apply its reconnect/fallback logic.

## Where to put
- `src/plugins/engines/engineFactory.ts` for the factory entry.
- `src/plugins/engines/` for individual engine implementations.

## Reuse from livepano
- Built-in helpers migrated from `ref/livepano` are available under `src/plugins/engines/` (zlm/srs/mediamtx/monibuca/oven/tencent).
- Call `registerDefaultEngines()` if you want them registered (core does not auto-register).
- Prefer `createSourceResolverMiddleware()` for `auto` sources. It converts `EngineFactory` output into a primary `Source` plus ordered `fallbacks`.
- If you need manual control, adjust outputs to match Fyra `Source` shape, e.g.:
  - webrtc: `{ type: 'webrtc', url, signal: {...} }`
  - ws-flv/http-flv: `{ type: 'ws-raw', url, codec: 'h264', transport: 'flv' }`
  - hls/dash: `{ type: 'hls' | 'dash', url }`
  - fallbackChain: set `techOrder` or provide `fallbacks` on the Source.

## Usage sketch
```ts
import { FyraPlayer } from '@bimccfyra/fyraplayer';
import {
  createSourceResolverMiddleware,
  registerDefaultEngines
} from '@bimccfyra/fyraplayer/plugins/engines';

registerDefaultEngines();

const player = new FyraPlayer({
  video: '#video',
  sources: [{
    type: 'auto',
    engine: 'mediamtx',
    url: 'rtsp://host/app/stream',
    preferTech: 'webrtc'
  }],
  middleware: [
    createSourceResolverMiddleware({
      protocols: ['webrtc', 'll-hls', 'hls'],
      wsRawCodec: 'h264'
    })
  ],
  techOrder: ['webrtc', 'ws-raw', 'hls', 'dash']
});
```

Resolver behavior:

- `fallbackChain` from the engine controls protocol order unless `protocols` is provided.
- `AutoSource.preferTech` can promote a matching resolved source to primary.
- Generated FLV sources use `ws-raw` with `pipeline: 'mse'`, which is the stable default.
- Duplicate protocol URLs are removed, so LL-HLS and HLS pointing to the same URL produce one fallback entry.
- Explicit `AutoSource.fallbacks` are appended after resolver-generated fallbacks.

## Notes
- Keep adapters decoupled from player internals; they only emit `Source` objects and optional `techOrder`.
- Do not reimplement fallback logic in adapters; rely on Fyra core tech selection and reconnect policy.
- Register your engines at startup:
  ```ts
  registerDefaultEngines(); // or EngineFactory.registerEngine(...) manually
  EngineFactory.setConfig({ mediamtx: { host: '...', ... } });
  ```
- Treat engines as optional: keep engine implementations in a separate folder/package or tree-shakable entry so you don't bloat the core bundle. Core does not ship any engines by default.
