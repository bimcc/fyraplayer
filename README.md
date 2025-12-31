# FyraPlayer

Modern, extensible low-latency web player focused on real-time streaming (WebRTC, LL-HLS/DASH, WS+WebCodecs/WASM). Provides a plugin/middleware architecture and optional UI shell.

## Features

- Techs: WebRTC (OME/WHIP/WHEP), WS-raw (WebCodecs/WASM, FLV/TS), HLS/DASH, GB28181, file/TS.
- Reliability: reconnect hooks, ICE restart, playoutDelayHint, packet-loss based ABR fallback, data-channel heartbeat.
- Extensible: middleware pipeline, plugin manager, signal adapters, engine URL factory, metadata (KLV/SEI) bridge points.
- Optional UI shell and adapters for panorama (PSV) / Cesium.

## Install

```bash
pnpm install
pnpm build
```

## Usage

```ts
import { FyraPlayer } from 'fyraplayer';

const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'webrtc', url: 'wss://example.com/webrtc' }],
  techOrder: ['webrtc', 'ws-raw', 'hlsdash', 'file'],
  buffer: { targetLatencyMs: 2000 },
  reconnect: { enabled: true }
});

await player.init();
await player.play();
```

## Scripts

- `pnpm build` — type build to `dist/`
- `pnpm test` — run jest tests
- `pnpm dev:vite` — run examples with Vite
- `pnpm bundle:examples` — bundle `examples/app.ts` with esbuild

## License

MIT
