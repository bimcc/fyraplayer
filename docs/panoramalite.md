# PanoramaLite WebGL2 Plugin Plan

> Created: 2026-05-19  
> Status: doing
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

## 4. Public API

The package path is implemented for the lightweight plugin baseline. Browser
pixel evidence is still pending, so product support claims must remain
conditional until `PLITE-009` is closed.

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
      viewerControls: true,
      initialView: { yaw: 0, pitch: 0, fov: 80 },
      powerPreference: 'high-performance',
    }),
  ],
});
```

Runtime mode guidance:

- installing the plugin and entering panorama mode are separate decisions;
- source platforms can request panorama mode through the stable source metadata
  contract:

  ```ts
  {
    type: 'hls',
    url: 'https://example.com/live360.m3u8',
    presentation: {
      mode: 'panorama',
      projection: 'equirectangular',
      renderer: 'panoramalite',
      textureFlipX: false,
      textureFlipY: false
    },
    tags: ['panorama']
  }
  ```

  Products should use `isPanoramaSource(source)` and
  `getSourcePresentation(source)` to decide whether to enable PanoramaLite and
  which source-specific orientation knobs to apply. `source.meta.presentation`
  is accepted for upstream platform API shapes that nest metadata;
- if `panoramalite` is installed when the player is created, it can bind the
  current `HTMLVideoElement`, so the current resource can be shown in panorama
  mode without changing Tech or reloading media. Use `enabled: false` to start
  in ordinary video mode, then call `handle.setEnabled(true)` when the user
  enters panorama mode;
- if the plugin is not installed on that player instance, the current public
  API does not expose hot plugin installation. Products should either create
  the player with PanoramaLite already installed but visually inactive, or
  destroy/recreate the player when enabling panorama for the first time;
- for a commercial product, plugin availability should be deployment/config
  driven. A settings panel may show installed plugins and expose safe runtime
  options, but it should not let end users arbitrarily load heavy or privileged
  plugins from the UI.
- frame-level KLV/SEI/container metadata should not be the first trigger for
  the initial UI mode. It arrives after source selection and differs by
  protocol; use source-platform metadata for startup, then use frame metadata
  only for domain overlays or later calibration.

Demo guidance:

- `examples/basic.html` is now the product-style unified demo. Its source list
  includes ordinary and `[全景]` sources in one selector. Selecting a panorama
  source automatically enables PanoramaLite mode; the normal UI shell is hidden
  and the PanoramaLite in-view controls take over playback/fullscreen actions.
- `examples/panoramalite.html` remains the focused renderer fixture and smoke
  automation target. Use it for orientation, canvas pixels, source-specific
  texture flips, and WebGL lifecycle checks.
- The main demo installs PanoramaLite with each player instance and starts it
  in standby for ordinary sources. This keeps runtime ordinary/panorama mode
  switching available without exposing arbitrary plugin installation in the UI.

Options:

```ts
export interface PanoramaLitePluginOptions {
  target?: HTMLElement | string;
  media?: 'video' | 'image';
  image?: string | HTMLImageElement | ImageBitmap;
  projection?: 'equirectangular';
  enabled?: boolean;
  interactive?: boolean;
  viewerControls?: boolean | PanoramaLiteViewerControlsOptions;
  initialView?: Partial<PanoramaLiteView>;
  limits?: Partial<PanoramaLiteViewLimits>;
  pixelRatio?: number | 'auto';
  maxPixelRatio?: number;
  maxCanvasPixels?: number;
  maxVideoFps?: number;
  powerPreference?: WebGLPowerPreference;
  textureFlipX?: boolean;
  textureFlipY?: boolean;
  preserveDrawingBuffer?: boolean;
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  hideSourceVideo?: boolean;
  className?: string;
  onReady?: (handle: PanoramaLiteHandle) => void;
  onError?: (error: unknown) => void;
}

export interface PanoramaLiteViewerControlsOptions {
  enabled?: boolean;
  playback?: boolean;
  seek?: boolean;
  loop?: boolean;
  volume?: boolean;
  fullscreen?: boolean;
  resetView?: boolean;
  className?: string;
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
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
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
- `enabled: true`;
- `interactive: true`;
- `viewerControls: undefined`, meaning no built-in viewer overlay unless
  explicitly enabled;
- `initialView: { yaw: 0, pitch: 0, roll: 0, fov: 80 }`;
- `limits: { minPitch: -85, maxPitch: 85, minFov: 35, maxFov: 110 }`;
- `pixelRatio: 'auto'`;
- `maxPixelRatio: 1.5`;
- `maxCanvasPixels: undefined`;
- `maxVideoFps: undefined`;
- `powerPreference: 'high-performance'`;
- `textureFlipX: false`;
- `textureFlipY: false`;
- `preserveDrawingBuffer: false`;
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
    controls.ts
  viewerControls.ts
  media/
    imageLoader.ts
```

Build/export plan:

- `./plugins/panoramalite` exists in `package.json` exports;
- `tsconfig.public-api.json` maps the public subpath;
- `checks/public-api-smoke.ts` covers direct and aggregate plugin imports;
- `src/plugins/index.ts` and the IIFE entry export the plugin factory and
  public helper types.

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
  updates, skip duplicate `presentedFrames` / `mediaTime`, and fall back to
  readiness/progress events;
- coalesce video frame callbacks, input changes, and resize notifications into
  `requestAnimationFrame()` so the renderer uploads and draws at most once per
  display frame;
- resize through `ResizeObserver` dirty flags instead of reading layout on
  every render;
- request the WebGL context with `powerPreference: 'high-performance'` by
  default, while allowing integrations to override it;
- do not generate mipmaps for live video textures;
- use `CLAMP_TO_EDGE` and `LINEAR` filtering;
- keep `preserveDrawingBuffer` disabled outside screenshots/automation because
  it can add GPU synchronization cost;
- cap canvas device pixel ratio through `maxPixelRatio` only as an explicit
  quality/performance tradeoff;
- cap video texture uploads through `maxVideoFps` only as an explicit fallback
  on constrained devices;
- cap canvas backing-store pixels through `maxCanvasPixels` only as an explicit
  fallback for high-DPI laptops, 4K displays, or many simultaneous viewers;
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
- optional `viewerControls` adds an in-view bottom control bar for fullscreen
  and touch usage. It can expose play/pause, seek for finite media, loop,
  mute/volume, reset view, and fullscreen;
- live streams without finite duration show live status and hide seek/loop;
- image sources hide video-only controls and keep reset/fullscreen controls;
- double click/tap reset can be considered after MVP if it does not conflict
  with the host UI.

Rules:

- clamp pitch and fov through `PanoramaLiteViewLimits`;
- wrap yaw continuously;
- keep the default interaction model screen-oriented: pointer/touch/wheel
  controls do not write roll/Z-axis rotation. Programmatic `setView({ roll })`
  remains available for integrations that intentionally own that axis;
- keep `viewerControls` opt-in so products can still own their full UI shell;
- expose view state through the handle so product UI can own presets, mini-maps,
  or PTZ-like controls later.

Screen, gyro, and VR boundary:

- current PanoramaLite is a screen panorama renderer, not a VR runtime;
- screen playback should normally expose yaw, pitch, and fov only. This matches
  common desktop/mobile panorama viewers where the display itself is stable;
- gyroscope/device-orientation mode would map phone sensor data to yaw/pitch
  and, when needed, roll. It requires permission handling, calibration,
  smoothing, and fallback controls, so it should be added as an explicit opt-in
  mode rather than changing the default screen behavior;
- headset VR is a different scope from screen playback: it needs WebXR or an
  equivalent device runtime, stereo cameras, per-eye viewports, presentation
  session lifecycle, and controller/input handling. Keep that out of
  `panoramalite` until a dedicated `panorama-vr` / WebXR plugin is planned.

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

Orientation and calibration:

- the demo default source is a generated 2:1 latitude/longitude grid with
  equator, front meridian, up/down, left/right, and back labels;
- `textureFlipX` and `textureFlipY` are public options for source-specific
  orientation correction;
- WebGL upload keeps `UNPACK_FLIP_Y_WEBGL` disabled by default, so image/video
  orientation is controlled in shader texture coordinates instead of hidden
  upload state;
- image and video sources default to `textureFlipX: false` and
  `textureFlipY: false`. The generated canvas/image fixture is the zero-flip
  calibration baseline; if it appears upside down or mirrored, the renderer or
  demo defaults are wrong rather than the baseline image;
- if a camera or encoder outputs inverted or mirrored equirectangular frames,
  confirm it with the grid first, then override `textureFlipX` or
  `textureFlipY` at integration level.

Performance interpretation:

- A single equirectangular sphere does not render the whole 360 frame to the
  screen; the GPU shades the visible canvas pixels. "Render only the visible
  range" is therefore already the normal rasterization behavior for this
  renderer.
- The expensive parts in live panorama are usually browser media decode timing,
  full video-frame texture upload, high-DPI canvas fill rate, and WebRTC
  network jitter. HLS often feels smoother because its buffer hides short-term
  jitter; WebRTC exposes it sooner by design.
- First-line optimizations must preserve quality: skip duplicate video frames,
  upload only when a real new frame arrives, coalesce render work into RAF,
  avoid per-frame layout reads, keep `preserveDrawingBuffer` off, and prefer the
  high-performance WebGL context.
- Quality-reducing controls (`maxVideoFps`, `maxCanvasPixels`, lower
  `maxPixelRatio`) are opt-in fallback knobs for weak clients or multi-view
  dashboards, not demo or SDK defaults.

## 11. Implementation Milestones

| ID | Status | Task | Acceptance |
|---|---:|---|---|
| PLITE-001 | done | Add docs and roadmap tracking | `docs/panoramalite.md`, roadmap, and plugin map describe the same scope |
| PLITE-002 | done | Add API/types and public export | `createPanoramaLitePlugin` compiles in public API smoke |
| PLITE-003 | done | Implement math, camera, and sphere mesh | Unit tests cover projection basics and view limits |
| PLITE-004 | done | Implement WebGL2 renderer and image texture | Renderer and image texture path exist; Edge smoke verifies nonblank generated image canvas |
| PLITE-005 | done | Implement video texture binding | Edge smoke verifies MP4/file, HLS VOD, live HLS, and live WebRTC video texture rendering |
| PLITE-006 | done | Implement interaction controls | Pointer drag changes view state and browser canvas pixels in smoke evidence |
| PLITE-007 | doing | Implement lifecycle and context recovery | Destroy/init-failure cleanup is unit-covered; smoke verifies canvas removal after destroy; source switch/context-restored browser evidence remains pending |
| PLITE-008 | done | Add example/demo preset | `examples/basic.html` is the unified ordinary/panorama product demo; `examples/panoramalite.html` can load image/video/HLS/WebRTC presets, keeps custom DASH URLs available through the smoke/API path, includes generated grid/Naver HLS/Radiant HLS/Electroteque HLS/MediaMTX/local-file presets, shows configured/active plugin status, and exposes a smoke API |
| PLITE-009 | done for smoke scope | Add browser verification records | Matrix documents image, file/video, HLS VOD, live HLS, and live WebRTC smoke evidence; long-run/resource-leak evidence can be tracked separately |
| PLITE-010 | doing | Add orientation/performance hardening | Default demo calibration grid exists; image and video sources now use zero-flip defaults, the sphere mesh uses non-mirrored equirectangular U coordinates, non-degrading scheduling/upload/layout/context optimizations are implemented, and default-quality live WebRTC/HLS smoke evidence exists |
| PLITE-011 | doing | Add in-view viewer controls | Optional viewer control bar exists for play/pause, seek, loop, mute/volume, reset view, and fullscreen; browser/manual fullscreen evidence remains pending |
| PLITE-012 | pending | Add explicit gyro / VR mode boundary | Default screen mode remains yaw/pitch/fov with stable horizon; future gyro mode should handle DeviceOrientation permission/calibration/smoothing; future headset VR should be a separate WebXR-oriented plugin |
| PLITE-013 | done | Merge ordinary and PanoramaLite product demo flow | Main demo has one source list, `[全景]` source prefixes, a runtime PanoramaLite switch, dynamic ordinary UI / viewer-control replacement, plugin status, and browser structural evidence |
| PLITE-014 | done | Standardize source presentation metadata | `Source` includes `presentation`, `meta.presentation`, and `tags`; `isPanoramaSource()` / `getSourcePresentation()` provide the app/plugin decision helper; demo sources use the formal metadata instead of demo-only `panorama: true`; auto-source resolver preserves presentation metadata |

## 12. Review Log

### 2026-05-19 Baseline Implementation

- Added the optional `fyraplayer/plugins/panoramalite` public entrypoint,
  aggregate plugin export, and IIFE export.
- Added `PlayerAPI.getVideoElement()` so renderer plugins can consume the
  player-owned media element without reaching into private player state.
- Implemented the lightweight WebGL2 baseline: equirectangular sphere mesh,
  camera/view math, video/image texture binding, pointer/touch/wheel controls,
  WebGL2 unsupported diagnostics, context loss/restoration hooks, visibility
  render scheduling, and lifecycle cleanup.
- Kept audio, playback, reconnect, quality control, and source switching owned
  by `FyraPlayer` and the active Tech.
- Added unit coverage for view normalization, mesh generation, video texture
  allocation after placeholder frames, unsupported WebGL2 diagnostics,
  renderer-init failure cleanup, and destroy-time host/video style restoration.
- Validation:
  - `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed,
    7 tests.
  - `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
  - `cmd /c pnpm check:release`: passed, 26 suites / 135 tests, 30 package
    export files, 18 example sources, public API check, ESM build, and IIFE
    bundle.

### 2026-05-19 Browser Smoke Closure Pass

- Added `examples/panoramalite.html` and `examples/panoramalite.ts` as the
  first runnable PanoramaLite demo.
- Added `pnpm smoke:panoramalite`, backed by `checks/panoramalite-smoke.mjs`,
  to drive Edge/Chrome through CDP and assert:
  - WebGL canvas exists and is nonblank;
  - pointer drag changes view state;
  - pointer drag changes sampled canvas pixels;
  - video scenarios reach playable media state;
  - destroy removes the PanoramaLite canvas.
- Added `crossOrigin` and `preserveDrawingBuffer` plugin options. The latter is
  intended for screenshots/automation and remains disabled by default.
- Improved video texture scheduling by listening to media element readiness and
  frame-progress events (`loadeddata`, `canplay`, `playing`, `timeupdate`,
  `seeked`) in addition to Player events. This fixed a real HLS smoke timing
  issue where video was playing but the first PanoramaLite canvas sample stayed
  black.
- Validation:
  - `cmd /c pnpm smoke:panoramalite -- --scenario image --duration 2s --out .fyra-long-run\panoramalite-image-edge.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --scenario file --source-url /testvideo/Rec%200017.mp4 --duration 6s --out .fyra-long-run\panoramalite-file-local-edge.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --scenario hls --source-url https://sf1-cdn-tos.huoshanstatic.com/obj/media-fe/xgplayer_doc_video/hls/xgplayer-demo.m3u8 --duration 8s --out .fyra-long-run\panoramalite-hls-demo-edge.json --fail-on-error`: passed.
- Additional live validation after MediaMTX/OBS became available:
  - `cmd /c pnpm smoke:panoramalite -- --scenario hls --source-url http://127.0.0.1:28888/live/test/index.m3u8 --duration 20s --out .fyra-long-run\panoramalite-hls-live-edge.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --scenario webrtc --source-url http://127.0.0.1:28889/live/test/whep --duration 8s --out .fyra-long-run\panoramalite-webrtc-live-edge.json --fail-on-error`: passed.
- The external Bitmovin 360 MP4 default source did not pass this smoke because
  the browser reported no supported source; same-origin local MP4 video texture
  evidence is used for this pass.

### 2026-05-19 Orientation And Live Performance Pass

- Replaced the demo's simple gradient image with a generated equirectangular
  calibration grid. The grid includes latitude/longitude lines, a yellow
  equator, a red front meridian, and explicit north/up, south/down, left,
  right, and back labels.
- Added `textureFlipX` and `textureFlipY` so products can correct camera/source
  orientation without changing renderer internals.
- Stopped forcing `UNPACK_FLIP_Y_WEBGL` on texture upload. Default orientation
  is now controlled by shader texture coordinates and is easier to reason about
  across images and video sources.
- Added `maxVideoFps` and `maxCanvasPixels` as explicit fallback controls for
  WebRTC/live panorama rendering because the single sphere is already
  rasterized only to visible screen pixels; the expensive part is full-frame
  texture upload and high-DPI canvas fill rate.
- Earlier demo validation used conservative caps (`maxPixelRatio: 1`,
  `maxCanvasPixels: 1280 * 720`, `maxVideoFps: 24/30`) to prove live stability
  quickly. These caps are no longer SDK/demo defaults; they remain opt-in
  fallback knobs.
- Validation:
  - `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed,
    8 tests.
  - `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
  - Final post-layout smoke:
    `cmd /c pnpm smoke:panoramalite -- --scenario image --duration 2s --out .fyra-long-run\panoramalite-grid-image-edge-final.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --scenario image --duration 2s --out .fyra-long-run\panoramalite-grid-image-edge.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --scenario hls --source-url http://127.0.0.1:28888/live/test/index.m3u8 --duration 12s --out .fyra-long-run\panoramalite-hls-live-optimized-edge.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --scenario webrtc --source-url http://127.0.0.1:28889/live/test/whep --duration 6s --out .fyra-long-run\panoramalite-webrtc-live-optimized-edge-retry.json --fail-on-error`: passed after one CDP-only retry.

### 2026-05-19 Default Quality Orientation And Scheduling Pass

- Split `textureFlipY` defaults by source type: images defaulted to `true`,
  videos defaulted to `false`, and explicit integration options still
  override. This was later corrected because the generated grid must be the
  zero-flip baseline.
- Added unit coverage for the then-current image-up and video-neutral Y
  defaults.
- Removed demo-level default caps for `maxPixelRatio`, `maxCanvasPixels`, and
  `maxVideoFps`. The demo now preserves quality by default; the caps remain
  public opt-in fallbacks.
- Limited `preserveDrawingBuffer` to `?smoke=1` automation mode because normal
  interactive playback does not need readback-stable buffers.
- Added non-degrading live-render optimizations:
  - use request-video-frame metadata to skip duplicate frames;
  - mark video frames dirty and upload only real new frames;
  - coalesce frame, input, and resize work through RAF;
  - use `ResizeObserver` dirty flags to avoid layout reads on every render;
  - cache `gl.MAX_TEXTURE_SIZE`;
  - request a high-performance WebGL context by default.
- Validation:
  - `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
  - `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed,
    10 tests.
  - `cmd /c pnpm smoke:panoramalite -- --scenario image --duration 2s --out .fyra-long-run\panoramalite-grid-image-orientation-default-quality-edge.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --port 4201 --scenario hls --source-url http://127.0.0.1:28888/live/test/index.m3u8 --duration 12s --out .fyra-long-run\panoramalite-hls-live-default-quality-edge.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --port 4202 --scenario webrtc --source-url http://127.0.0.1:28889/live/test/whep --duration 10s --out .fyra-long-run\panoramalite-webrtc-live-default-quality-edge.json --fail-on-error`: passed.

### 2026-05-20 Viewer Controls And X Orientation Pass

- Changed the video-source `textureFlipX` default to `true` so PanoramaLite
  video matches ordinary FyraPlayer/video-element left/right orientation without
  requiring users to click Flip X in the demo.
- Kept image-source `textureFlipX` default at `false`; image vertical
  correction was still `textureFlipY: true` in this pass, which was later
  corrected because the generated grid is the zero-flip baseline.
- Added optional `viewerControls`, disabled by default for SDK purity and
  enabled in the demo. The overlay supports play/pause, seek for finite video,
  loop, mute/volume, reset view, and fullscreen; it hides seek/loop for live
  streams and hides video-only controls for images.
- Refined the default overlay style to a lightweight bottom floating control
  cluster with transparent container chrome, so it does not cover the panorama
  with a full-width control bar. Live mode keeps the cluster compact by hiding
  seek, loop, the live label, and the volume slider while retaining play/pause,
  mute/unmute, reset, and fullscreen.
- Routed the viewer control play/pause buttons through the FyraPlayer
  `PlayerAPI` instead of calling the raw `HTMLVideoElement` directly, so the
  overlay stays aligned with player state, middleware, and future reconnect
  behavior.
- Exported `PanoramaLiteViewerControlsOptions` from both PanoramaLite and
  aggregate plugin entry points for external TypeScript integrations.
- Remaining viewer-control hardening:
  - keyboard/focus polish;
  - VR/WebXR presentation integration;
  - mobile safe-area polish;
  - branded icon replacement if product UI wants icon-only controls.
- Validation:
  - `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
  - `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed,
    11 tests.
  - `cmd /c pnpm smoke:panoramalite -- --port 4224 --scenario image --duration 3s --out .fyra-long-run\panoramalite-viewer-controls-image-edge-20260520-retry.json --fail-on-error`: passed after one concurrent automation timeout.
  - `cmd /c pnpm smoke:panoramalite -- --port 4221 --scenario hls --source-url http://127.0.0.1:28888/live/test/index.m3u8 --duration 12s --out .fyra-long-run\panoramalite-hls-video-x-default-edge-20260520.json --fail-on-error`: passed.
  - `cmd /c pnpm smoke:panoramalite -- --port 4225 --scenario webrtc --source-url http://127.0.0.1:28889/live/test/whep --duration 10s --out .fyra-long-run\panoramalite-webrtc-video-x-default-edge-20260520-retry.json --fail-on-error`: passed after one CDP-only timeout.

### 2026-05-20 Image Baseline Orientation Correction

- Corrected the image-source default orientation to zero flip:
  `textureFlipX: false` and `textureFlipY: false`.
- Changed the demo orientation defaults so the generated latitude/longitude
  grid starts with both `Flip X` and `Flip Y` unchecked. This grid is now the
  calibration baseline; if it appears upside down without explicit flips, the
  renderer or demo defaults are wrong.
- Corrected the sphere mesh U coordinates from mirrored `1 - u` to standard
  equirectangular `u` after browser screenshot review showed the zero-flip grid
  was horizontally mirrored.
- Changed video-source defaults to the same zero-flip baseline:
  `textureFlipX: false` and `textureFlipY: false`. Explicit flips remain
  available for camera-specific or encoder-specific exceptions.
- Updated unit coverage and public docs to remove the older image-Y-flip
  and video-X-flip assumptions.
- Validation:
  - browser screenshot review on `http://127.0.0.1:4197/panoramalite.html`
    confirmed `Flip X` and `Flip Y` both unchecked with readable
    `FRONT 0deg` / latitude labels;
  - `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed;
  - `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed;
  - `cmd /c pnpm smoke:panoramalite -- --port 4230 --scenario image --duration 3s --out .fyra-long-run\panoramalite-image-zero-flip-baseline-edge-20260520.json --fail-on-error`: passed.

### 2026-05-20 Demo Source Refresh And Runtime Mode Guidance

- Added PanoramaLite demo presets for:
  - Naver equirectangular HLS:
    `https://naver.github.io/egjs-view360/pano/equirect/m3u8/equi.m3u8`;
  - Radiant Media Player Lac de Bimont HLS:
    `https://cdn.radiantmediatechs.com/rmp/media/samples-for-rmp-site/04052024-lac-de-bimont/hls/playlist.m3u8`;
  - Electroteque Ultra Light Flight HLS:
    `https://videos.electroteque.org/360/hls/ultra_light_flight.m3u8`.
- Removed the old Bitmovin Playhouse 360 HLS/MP4/DASH demo defaults from
  `examples/sources.js` and stopped using them as PanoramaLite smoke defaults.
- Added a preset selector to `examples/panoramalite.html`; custom URLs still
  work and the smoke API now marks external inputs as custom.
- Added `enabled` / `handle.setEnabled()` so a player created with
  PanoramaLite can keep the current stream and switch between ordinary video
  and panorama rendering at runtime.
- Added a demo plugin-status panel for configured plugins, active plugin state,
  and current ordinary/panorama mode. This is a visibility/status surface, not
  user-driven plugin installation.
- Documented the product boundary: install plugins through deployment/config,
  then expose safe runtime mode toggles such as panorama on/off. Hot plugin
  installation is not a current public API.
- Validation:
  - `curl.exe -L` confirmed the added public HLS playlists return 200;
  - `cmd /c pnpm check:sources`: passed, 17 example sources;
  - `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed;
  - `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed;
  - `cmd /c pnpm check:release`: passed, 26 suites / 141 tests plus public API, exports, source contract, and IIFE bundle;
  - `cmd /c pnpm smoke:panoramalite -- --port 4233 --scenario hls --source-url https://naver.github.io/egjs-view360/pano/equirect/m3u8/equi.m3u8 --duration 8s --out .fyra-long-run\panoramalite-hls-naver-equirect-edge-20260520-runtime-mode.json --fail-on-error`: passed;
  - `cmd /c pnpm smoke:panoramalite -- --port 4234 --scenario hls --source-url https://cdn.radiantmediatechs.com/rmp/media/samples-for-rmp-site/04052024-lac-de-bimont/hls/playlist.m3u8 --duration 8s --out .fyra-long-run\panoramalite-hls-radiant-lac-de-bimont-edge-20260520-runtime-mode.json --fail-on-error`: passed;
  - `cmd /c pnpm smoke:panoramalite -- --port 4235 --scenario hls --source-url https://videos.electroteque.org/360/hls/ultra_light_flight.m3u8 --duration 8s --out .fyra-long-run\panoramalite-hls-electroteque-ultra-light-flight-edge-20260520.json --fail-on-error`: passed;
  - Playwright manual check on `http://127.0.0.1:4240/panoramalite.html` confirmed the Plugins panel reports `panoramalite:on`, and disabling Panorama changes `handle.isEnabled()` to `false`, hides the canvas, and reports `panoramalite:standby`.

### 2026-05-20 Z-Axis Roll Boundary Cleanup

- Removed the temporary visible Z-axis locking switch and related public handle
  methods from the demo/API. That approach locked the view state but did not
  address projection or camera-order visual tilt, so keeping it would mislead
  product validation.
- Kept `PanoramaLiteView.roll` and programmatic `setView({ roll })` available
  for future gyro, WebXR, or product-owned orientation integrations.
- Kept the screen interaction model unchanged: mouse/touch drag writes only
  `yaw` and `pitch`, wheel/pinch writes only `fov`.
- The demo still displays the current `roll` value as a diagnostic readout.
  During normal screen interaction it should remain stable; if the horizon
  visually tilts while `roll` stays unchanged, investigate camera matrix,
  rotation order, or horizon-stabilization behavior.
- Validation:
  - `cmd /c pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed,
    14 tests.
  - `cmd /c pnpm check:public-api`: passed.
  - `cmd /c pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed.
  - `cmd /c pnpm check:sources`: passed, 18 example sources.
  - `cmd /c pnpm bundle:examples`: passed.
  - `git diff --check`: passed.
  - `cmd /c pnpm check:release`: passed, 26 suites / 142 tests plus public
    API, exports, source contract, and IIFE bundle.
  - `cmd /c pnpm smoke:panoramalite -- --port 4242 --scenario image --duration 3s --out .fyra-long-run\panoramalite-screen-roll-stable-image-edge-20260520.json --fail-on-error`: passed with `rollStableAfterDrag: true`.
  - Playwright check on `http://127.0.0.1:4240/panoramalite.html` confirmed
    the Z-axis locking switch is absent, the status shows
    `roll 0.0`, and pointer drag changed `yaw/pitch` while `rollDelta = 0`.

### 2026-05-20 Unified Product Demo Integration

- Merged the ordinary player demo and PanoramaLite demo behavior into
  `examples/basic.html` / `examples/app.ts`.
- The main source selector now shows one combined list. Sources marked
  `panorama: true` in `examples/sources.js` are displayed with a `[全景]`
  prefix and automatically enable PanoramaLite mode when selected.
- The demo installs PanoramaLite on each player instance, keeps it in standby
  for ordinary sources, and exposes `window.fyraPanorama` for browser/manual
  diagnostics.
- Runtime mode switching now replaces the visible control surface: ordinary
  mode shows the normal UI plugin shell; panorama mode hides that shell and
  shows PanoramaLite viewer controls. Native video controls are also hidden in
  panorama mode.
- Panorama-specific options are shown only while panorama mode is active.
  `Flip X` / `Flip Y` remain explicit source/integration correction knobs and
  reload the current player because texture coordinate transforms are renderer
  construction options.
- Validation:
  - `pnpm bundle:examples`: passed;
  - `pnpm check:sources`: passed, 18 example sources;
  - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed;
  - `pnpm check:public-api`: passed;
  - `pnpm exec jest tests/panoramalite.test.ts --runInBand`: passed,
    14 tests;
  - `git diff --check`: passed;
  - `pnpm check:release`: passed, 26 suites / 142 tests plus public API,
    exports, source contract, and IIFE bundle;
  - Playwright on `http://127.0.0.1:4246/basic.html` confirmed three `[全景]`
    source options, PanoramaLite auto-enable for Naver HLS, hidden normal UI
    in panorama mode, one PanoramaLite canvas, `handle.isEnabled() === true`,
    and ordinary UI restoration after disabling panorama mode.

### 2026-05-20 Source Presentation Metadata Contract

- Added formal source-level presentation metadata:
  `source.presentation`, `source.meta.presentation`, and `source.tags`.
- Added public helpers `getSourcePresentation()` and `isPanoramaSource()` so
  product integrations can trigger PanoramaLite from a video-source platform
  response instead of hard-coding URL lists or relying on frame metadata.
- Updated `examples/sources.js` to mark public panorama HLS samples with:

  ```ts
  presentation: {
    mode: 'panorama',
    projection: 'equirectangular',
    renderer: 'panoramalite'
  },
  tags: ['panorama']
  ```

- Kept the older demo-only `panorama: true` path as a compatibility inference
  inside the helper/demo, but new platform integrations should use
  `presentation`.
- Updated source resolver middleware so an `auto` source returned by a video
  platform keeps its presentation metadata after conversion into concrete
  HLS/DASH/WebRTC fallback sources.
- Validation:
  - `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`: passed;
  - `pnpm exec jest tests/source-presentation.test.ts tests/source-resolver.test.ts --runInBand`: passed;
  - `pnpm exec jest tests/source-presentation.test.ts tests/source-resolver.test.ts tests/panoramalite.test.ts --runInBand`: passed, 24 tests;
  - `pnpm check:sources`: passed, 18 example sources;
  - `pnpm check:public-api`: passed;
  - `pnpm bundle:examples`: passed;
  - `pnpm check:release`: passed, 27 suites / 145 tests plus public API,
    exports, source contract, and IIFE bundle;
  - Playwright on `http://127.0.0.1:4247/basic.html` confirmed the Naver
    `[全景]` preset carries `presentation.mode = 'panorama'` and
    `tags: ['panorama']`, auto-enables PanoramaLite, hides the ordinary UI
    shell, and renders the PanoramaLite canvas.

## 13. Advanced Plugin Boundary

`panoramalite` is the basic built-in path. The following should stay separate:

- `panorama-three` or app-owned Three.js bridge for complex 3D scenes;
- `panorama-psv` / `@beeviz/fyrapano` for Photo Sphere Viewer features such as
  hotspots, tours, markers, and richer panorama UI;
- `panorama-webgpu` for future dewarp, stitching, high-resolution transforms,
  and GPU compute workflows;
- Cesium/map/GIS packages for geo-referenced projection.

Do not add those dependencies to `panoramalite`.
