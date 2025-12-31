# Fyra + Photo Sphere Viewer (PSV) Integration Guide

Goal: use FyraPlayer as the low-latency playback engine, and feed its video output to PSV for panorama rendering.

## What you need
- FyraPlayer (this repo build).
- Photo Sphere Viewer (`@photo-sphere-viewer/core`) in your app.
- Optional: panoramaRenderer (for lower-latency WebGL texture path) or plain `<video>` + captureStream.

## Adapter
- `src/integrations/psv/FyraPsvAdapter.ts` is a thin helper around FyraPlayer.
- It is **not auto-registered**; you must import and register a PSV plugin yourself (or wrap this adapter into your own PSV plugin class).
- Consider bundling a standalone entry (e.g., `dist/fyra-psv-plugin.js` UMD/ESM) for easy import.

## Quick start (PSV side)
```js
import PhotoSphereViewer from '@photo-sphere-viewer/core';
import { createFyraPsvPlugin } from 'fyraplayer'; // re-exported helper
const FyraPsvPlugin = createFyraPsvPlugin(PhotoSphereViewer);
PhotoSphereViewer.registerPlugin(FyraPsvPlugin);

const videoEl = document.querySelector('#fyra-video'); // hidden or offscreen
const sources = [
  { type: 'webrtc', url: 'wss://example.com/webrtc', signal: { type: 'whep', url: '...' } },
  { type: 'ws-raw', url: 'wss://example.com/live.flv', codec: 'h264', transport: 'flv' }
];

const psv = new PhotoSphereViewer({
  container: '#psv',
  panorama: 'placeholder.jpg', // will be replaced by live texture
  plugins: [
    [FyraPsvPlugin, {
      video: videoEl,
      sources,
      techOrder: ['webrtc', 'ws-raw', 'hlsdash']
      // useFrameHook: true, // optional: VideoFrame hook + panoramaRenderer captureStream
    }]
  ]
});
```

### UMD usage
```html
<script src="photo-sphere-viewer.js"></script>
<script src="fyraplayer.umd.js"></script>
<script>
  const FyraPsvPlugin = fyraplayer.createFyraPsvPlugin(PhotoSphereViewer);
  PhotoSphereViewer.registerPlugin(FyraPsvPlugin);
  // ... instantiate PSV with [FyraPsvPlugin, { video, sources, techOrder }]
</script>
```

## Responsibilities
- Adapter: create/manage FyraPlayer; feed PSV with the video/canvas (plain or panoramaRenderer/captureStream); forward ready/play/pause/error/network/stats/metadata as needed.
- PSV consumer: explicitly import and register the plugin; provide the `<video>` element and Fyra Sources.

## Tips
- For the lowest latency panorama: use `panoramaRenderer` + `VideoFrame -> WebGL` if available; fallback to `<video>.captureStream()` for compatibility.
- Reuse livepano viewport/quality heuristics if desired by extending the adapter.
