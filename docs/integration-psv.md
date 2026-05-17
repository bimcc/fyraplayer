# Fyra + Photo Sphere Viewer (PSV) Integration Guide

Goal: use FyraPlayer as the low-latency playback engine, and feed its video output to PSV for panorama rendering.

## What you need
- FyraPlayer (this repo build).
- Photo Sphere Viewer (`@photo-sphere-viewer/core`) in your app.
- Optional: panoramaRenderer (for lower-latency WebGL texture path) or plain `<video>` + captureStream.

## Adapter
- PSV integration is owned by the external `@beeviz/fyrapano` package, not the `fyraplayer` package entrypoints.
- FyraPlayer provides playback, events, and the `<video>` output; the PSV package owns viewer-specific plugin registration and rendering.
- Do not import PSV helpers from `fyraplayer`; use the external integration package or build an app-local adapter.

## Quick start (PSV side)
```js
import PhotoSphereViewer from '@photo-sphere-viewer/core';
import { createFyraPsvPlugin } from '@beeviz/fyrapano';
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
      techOrder: ['webrtc', 'ws-raw', 'hls', 'dash']
      // useFrameHook: true, // optional: VideoFrame hook + panoramaRenderer captureStream
    }]
  ]
});
```

### UMD usage
```html
<script src="photo-sphere-viewer.js"></script>
<script src="fyrapano.umd.js"></script>
<script>
  const FyraPsvPlugin = fyrapano.createFyraPsvPlugin(PhotoSphereViewer);
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
