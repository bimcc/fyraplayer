# Fyra + Cesium Integration Guide (with KLV)

Goal: use FyraPlayer for low-latency playback, feed video to Cesium (via @beeviz/cesium VideoSource), and bridge metadata to @beeviz/klv for attitude/position/time sync.

## What you need
- FyraPlayer (this repo build).
- `@beeviz/cesium` (VideoSource, UAVVisualizer, projection tools).
- `@beeviz/klv` for MISB/KLV parsing and time sync.

## Adapter
- `src/integrations/cesium/FyraCesiumAdapter.ts`: runs FyraPlayer, exposes `videoEl`, forwards metadata hook.
- `src/integrations/metadata/KlvBridge.ts`: bridge Fyra `metadata` events (raw private-data/SEI payload + pts) into `@beeviz/klv` parser; you provide parse/onData logic.

## Quick start (sketch)
```ts
import { FyraCesiumAdapter } from 'fyraplayer';
import { KlvBridge } from 'fyraplayer';
import { KLVStreamManager } from '@beeviz/klv';
import { VideoSource, UAVVisualizer } from '@beeviz/cesium';

const videoEl = document.querySelector('#fyra-video') as HTMLVideoElement;
const sources = [
  { type: 'ws-raw', url: 'wss://example.com/live.ts', codec: 'h264', transport: 'ts', metadata: { privateData: { enable: true } } }
];

const klvManager = new KLVStreamManager();
const bridge = new KlvBridge({
  parse: (evt) => klvManager.pushPacket(evt.raw, evt.pts),
  onData: (result) => {
    // result may contain attitude/position; feed to Cesium visualizers
    uav.updatePose(result);
  },
  onError: (err) => console.warn('KLV parse error', err)
});

const adapter = new FyraCesiumAdapter({
  video: videoEl,
  sources,
  techOrder: ['ws-raw', 'hlsdash'],
  onMetadata: (evt) => bridge.handle(evt),
  // frameHook: (frame) => { /* VideoFrame -> custom texture upload (WebCodecs path) */ }
});

await adapter.init();

// Cesium side
const videoSource = new VideoSource(videoEl);
const uav = new UAVVisualizer(viewer, {/* options */});
// Use videoSource.createTexture(viewer.scene.context) for materials/imagery layers
```

## Responsibilities
- Fyra: pull/dec/handle fallback; emit `metadata` events with raw payload+pts; manage reconnect.
- KlvBridge + @beeviz/klv: parse/sync metadata, produce pose/geo/time outputs.
- @beeviz/cesium: consume `videoEl` as texture; render UAV/trajectory/FOV using parsed metadata.

## Tips
- Enable metadata extraction on the ws-raw Source: `metadata.privateData.enable` or `metadata.sei.enable`.
- If only detection is desired first, use `detectOnly` and later call `enableMetadataExtraction()` on ws-raw tech (via player API).
- Keep Fyra core free of KLV logic; all semantic parsing stays in @beeviz/klv via KlvBridge.
