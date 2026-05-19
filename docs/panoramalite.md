# PanoramaLite WebGL2 Plugin Plan

> Created: 2026-05-19  
> Status: planned  
> Purpose: track the lightweight first-party panorama renderer for panoramic
> video, panoramic images, and live panorama playback without adding Three.js,
> PSV, or WebGPU to the core player.

## 1. Decision

The plugin name is `panoramalite`.

`panoramalite` is a lightweight WebGL2 renderer plugin. It is not a playback
Tech. FyraPlayer keeps owning media loading, audio, reconnect, quality control,
diagnostics, and source switching. `panoramalite` consumes the active
`HTMLVideoElement` or an image source and renders it as an interactive panorama
on a WebGL2 canvas.

This keeps the core player small while giving products a built-in lightweight
panorama path. Advanced viewer integrations such as Photo Sphere Viewer,
Three.js scenes, WebXR, tours, hotspots, and tiled panoramas remain separate
advanced plugins or external packages.

## 2. Product Goals

Supported first:

- equirectangular 2:1 panoramic video;
- equirectangular 2:1 panoramic image;
- live panorama playback from existing FyraPlayer sources, including HLS,
  WebRTC, fMP4, DASH, MP4/file, and any future Tech that renders to the shared
  `HTMLVideoElement`;
- mouse drag, touch drag, wheel zoom, and pinch zoom;
- stable resize, source switch, player destroy, and plugin destroy behavior;
- low dependency cost: no Three.js, PSV, OGL, or WebGPU runtime dependency.

Not first:

- dual-fisheye dewarp;
- multi-fisheye stitching;
- cubemap video/image;
- tiled panorama;
- hotspots/tours/markers;
- device orientation / gyroscope controls;
- WebXR / VR;
- WebGPU compute/rendering;
- renderer-specific UI beyond minimal interaction.

## 3. Boundary

FyraPlayer owns:

- media protocol handling and playback Tech selection;
- audio output;
- source fallback and reconnect;
- HLS/DASH quality control;
- playback state and events;
- diagnostics, QoS, and metrics events;
- UI controls and recording/screenshot hooks when those plugins are enabled.

`panoramalite` owns:

- WebGL2 canvas creation and layout;
- equirectangular sphere mesh generation;
- video/image texture upload;
- camera math for yaw, pitch, roll, and field of view;
- pointer/touch/wheel controls;
- WebGL context loss/restoration;
- renderer lifecycle cleanup;
- panorama-specific diagnostics.

The plugin must not patch Tech implementations or replace the video element's
playback lifecycle.

## 4. Public API Draft

This section is a future API draft. The package path must not be added to
`package.json` exports until the implementation, tests, and browser evidence are
in place.

Package path:

```ts
import { createPanoramaLitePlugin } from 'fyraplayer/plugins/panoramalite';
```

Example:

```ts
const player = new FyraPlayer({
  video: '#video',
  sources: [{ type: 'hls', url: 'https://example.com/live360.m3u8' }],
  plugins: [
    createPanoramaLitePlugin({
      target: '.player-shell',
      media: 'video',
      projection: 'equirectangular',
      interactive: true,
      initialView: { yaw: 0, pitch: 0, fov: 80 },
    }),
  ],
});
```

Options:

```ts
export interface PanoramaLitePluginOptions {
  target?: HTMLElement | string;
  media?: 'video' | 'image';
  image?: string | HTMLImageElement | ImageBitmap;
  projection?: 'equirectangular';
  interactive?: boolean;
  initialView?: Partial<PanoramaLiteView>;
  limits?: Partial<PanoramaLiteViewLimits>;
  pixelRatio?: number | 'auto';
  maxPixelRatio?: number;
  hideSourceVideo?: boolean;
  className?: string;
  onReady?: (handle: PanoramaLiteHandle) => void;
  onError?: (error: unknown) => void;
}

export interface PanoramaLiteView {
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
}

export interface PanoramaLiteViewLimits {
  minPitch: number;
  maxPitch: number;
  minFov: number;
  maxFov: number;
}

export interface PanoramaLiteHandle {
  setView(view: Partial<PanoramaLiteView>): void;
  getView(): PanoramaLiteView;
  resetView(): void;
  bindVideo(video: HTMLVideoElement): void;
  setImage(image: string | HTMLImageElement | ImageBitmap): Promise<void>;
  setInteractive(enabled: boolean): void;
  resize(): void;
  destroy(): void;
}
```

Defaults:

- `media: 'video'`;
- `projection: 'equirectangular'`;
- `interactive: true`;
- `initialView: { yaw: 0, pitch: 0, roll: 0, fov: 80 }`;
- `limits: { minPitch: -85, maxPitch: 85, minFov: 35, maxFov: 110 }`;
- `pixelRatio: 'auto'`;
- `maxPixelRatio: 1.5`;
- `hideSourceVideo: true`.

## 5. Module Shape

Planned files:

```text
src/plugins/panoramalite/
  index.ts
  plugin.ts
  types.ts
  renderer/
    PanoramaLiteRenderer.ts
    shaders.ts
    sphereMesh.ts
    texture.ts
    camera.ts
    math.ts
  input/
    pointerControls.ts
    touchControls.ts
    wheelControls.ts
  media/
    imageLoader.ts
    videoTexture.ts
  lifecycle/
    contextLoss.ts
    resizeObserver.ts
```

Build/export plan:

- add `./plugins/panoramalite` to `package.json` exports only when the
  implementation exists;
- add path mapping to `tsconfig.public-api.json`;
- extend `checks/public-api-smoke.ts`;
- keep it out of the core entry unless the plugin aggregate exports it.

## 6. Rendering Design

Rendering pipeline:

```text
FyraPlayer Tech -> HTMLVideoElement
                         |
                         v
PanoramaLitePlugin -> WebGL2 Canvas
                         |
                         v
Video/Image Texture -> Inverted Sphere -> Camera -> Screen
```

Renderer details:

- require WebGL2 for the first implementation;
- fail cleanly with `PANORAMALITE_UNSUPPORTED` if WebGL2 is unavailable;
- use a single inverted sphere mesh for equirectangular projection;
- use simple vertex/fragment shaders and one texture sampler;
- upload video frames through `texSubImage2D`;
- prefer `HTMLVideoElement.requestVideoFrameCallback()` for video texture
  updates and fall back to `requestAnimationFrame()`;
- do not generate mipmaps for live video textures;
- use `CLAMP_TO_EDGE` and `LINEAR` filtering;
- cap canvas device pixel ratio to protect fill rate on high-DPI displays;
- check `gl.MAX_TEXTURE_SIZE` before binding large images or videos when
  dimensions are known.

The original video element remains responsible for playback and audio. The
plugin may visually hide the video element, but it must not detach it from the
player or mute audio.

## 7. Interaction Design

Controls:

- mouse drag changes yaw/pitch;
- single-touch drag changes yaw/pitch;
- wheel zoom changes fov;
- pinch zoom changes fov;
- double click/tap reset can be considered after MVP if it does not conflict
  with the host UI.

Rules:

- clamp pitch and fov through `PanoramaLiteViewLimits`;
- wrap yaw continuously;
- avoid text overlays and controls inside the renderer itself;
- expose view state through the handle so product UI can own buttons, presets,
  mini-maps, or PTZ-like controls later.

## 8. Lifecycle

Required lifecycle behavior:

- create canvas under `target` or beside the video host;
- bind the initial player video element after plugin initialization;
- re-check the video element on source switch / ready if needed;
- pause render scheduling when the document is hidden;
- resume safely on visibility return;
- handle `webglcontextlost` by preventing default and emitting diagnostics;
- handle `webglcontextrestored` by rebuilding shaders, buffers, textures, and
  current media binding;
- remove all DOM, video, bus, resize, and visibility listeners on destroy;
- delete WebGL textures, buffers, vertex arrays, programs, and shaders on
  destroy.

## 9. Diagnostics

Stable QoS codes to add with implementation:

- `PANORAMALITE_UNSUPPORTED`;
- `PANORAMALITE_READY`;
- `PANORAMALITE_RENDER_ERROR`;
- `PANORAMALITE_CONTEXT_LOST`;
- `PANORAMALITE_CONTEXT_RESTORED`;
- `PANORAMALITE_TEXTURE_ERROR`;

Example event:

```ts
coreBus.emit('qos', {
  type: 'panoramalite-ready',
  code: 'PANORAMALITE_READY',
  severity: 'info',
  message: 'PanoramaLite renderer ready',
});
```

## 10. Testing And Evidence

Unit tests:

- view clamp and yaw wrapping;
- sphere mesh vertex/uv/index generation;
- plugin lifecycle registers and unregisters listeners;
- image loader rejects invalid sources;
- unsupported WebGL2 path emits a structured QoS event;
- context restored rebuild path calls renderer initialization.

Browser evidence:

- panoramic image renders nonblank canvas;
- panoramic MP4/file renders nonblank canvas;
- HLS 360 sample renders nonblank canvas;
- WebRTC/MediaMTX live source renders nonblank canvas when available;
- pointer drag changes pixel output;
- wheel/pinch changes fov;
- source switch keeps or rebinds the renderer;
- destroy removes canvas/listeners and stops the render loop.

Verification tools:

- Playwright screenshot with canvas pixel checks;
- desktop and mobile viewport checks;
- long-run sampling for WebGL resource leaks after the MVP is stable.

## 11. Implementation Milestones

| ID | Status | Task | Acceptance |
|---|---:|---|---|
| PLITE-001 | todo | Add docs and roadmap tracking | `docs/panoramalite.md`, roadmap, and plugin map describe the same scope |
| PLITE-002 | todo | Add API/types and public export | `createPanoramaLitePlugin` compiles in public API smoke |
| PLITE-003 | todo | Implement math, camera, and sphere mesh | Unit tests cover projection basics and view limits |
| PLITE-004 | todo | Implement WebGL2 renderer and image texture | Browser screenshot shows nonblank panoramic image render |
| PLITE-005 | todo | Implement video texture binding | MP4/HLS 360 sample renders nonblank and updates over time |
| PLITE-006 | todo | Implement interaction controls | Drag and zoom change view state and screenshot pixels |
| PLITE-007 | todo | Implement lifecycle and context recovery | Destroy/source switch/context lost behavior is tested |
| PLITE-008 | todo | Add example/demo preset | Example can toggle panoramic image/video/live source without custom glue |
| PLITE-009 | todo | Add browser verification records | Matrix documents image, file/video, HLS, and live-source evidence |

## 12. Advanced Plugin Boundary

`panoramalite` is the basic built-in path. The following should stay separate:

- `panorama-three` or app-owned Three.js bridge for complex 3D scenes;
- `panorama-psv` / `@beeviz/fyrapano` for Photo Sphere Viewer features such as
  hotspots, tours, markers, and richer panorama UI;
- `panorama-webgpu` for future dewarp, stitching, high-resolution transforms,
  and GPU compute workflows;
- Cesium/map/GIS packages for geo-referenced projection.

Do not add those dependencies to `panoramalite`.
