# Render Bridges

> Created: 2026-05-18
> Purpose: keep PSV, Cesium, map, panorama, and custom WebGL integrations outside FyraPlayer core while documenting the supported bridge contract.

FyraPlayer is the playback SDK. It owns source selection, protocol Techs,
reconnect/fallback behavior, playback events, stats, quality controls, and raw
metadata events. Product renderers own panorama projection, 3D scene
management, GIS overlays, camera models, and domain visualization.

Do not add PSV, Cesium, map, or panorama SDK dependencies to `fyraplayer`.
Those adapters should live in renderer packages such as `@beeviz/fyrapano`,
`@beeviz/cesium`, or app-local bridge packages.

## Supported Outputs

External bridges can rely on these stable player-facing outputs:

| Output | Source | Use |
|---|---|---|
| `HTMLVideoElement` | `PlayerOptions.video` | Default texture input for PSV, Cesium, maps, and custom WebGL renderers |
| Player events | `player.on(...)` | Forward `ready`, `play`, `pause`, `error`, `network`, `stats`, `qos`, `metadata`, and `levelSwitch` into renderer UI |
| Playback API | `play()`, `pause()`, `seek()`, `switchSource()`, `getQualityState()`, `setQualityLevel()` | Let renderer controls drive playback without touching Tech internals |
| Metadata events | `metadata` + `createMetadataPlugin()` / `KlvBridge` | Connect KLV/SEI/private data to domain parsers and scene synchronization |
| `CanvasFrameBuffer` | `fyraplayer` main export | Optional canvas-backed texture/captureStream source for renderers that cannot consume the original video directly |
| `BaseTarget` | `fyraplayer` main export | Optional base class for app-owned render targets |
| Diagnostics | `createDiagnosticsPlugin()` | Export player state and recent evidence from renderer support consoles |

## Ownership Boundary

| Layer | Owns | Does Not Own |
|---|---|---|
| FyraPlayer | Media loading, Tech selection, reconnect, quality control, stats, metadata emission, generic video/canvas output helpers | PSV plugins, Cesium scene graph, GIS layers, panorama sphere mapping, UAV visualization, camera calibration UI |
| Renderer bridge package | Adapter lifecycle, renderer dependency imports, video/canvas texture wiring, renderer controls, scene synchronization | Core playback protocol handling or internal Tech mutation |
| Product application | Backend URLs, auth, stream-server resolver config, layout, business controls, telemetry, deployment policy | Forking core playback code for renderer-specific behavior |

## Bridge Pattern

Create the renderer and the player side by side. The bridge should subscribe to
public events and clean up both the player and renderer listeners.

```ts
import { FyraPlayer, type PlayerAPI, type Source } from 'fyraplayer';
import { createDiagnosticsPlugin } from 'fyraplayer/plugins/diagnostics';

export interface RenderBridge {
  readonly player: PlayerAPI;
  destroy(): Promise<void>;
}

export function createRendererBridge(options: {
  video: HTMLVideoElement;
  sources: Source[];
  mountVideoTexture(video: HTMLVideoElement): void;
  unmountVideoTexture(): void;
  report?: (event: unknown) => void;
}): RenderBridge {
  const player = new FyraPlayer({
    video: options.video,
    sources: options.sources,
    plugins: [
      createDiagnosticsPlugin({
        onSnapshot: (snapshot) => options.report?.(snapshot)
      })
    ]
  });

  const onReady = () => options.mountVideoTexture(options.video);
  const onNetwork = (event: unknown) => options.report?.(event);
  player.on('ready', onReady);
  player.on('network', onNetwork);

  return {
    player,
    destroy: async () => {
      player.off('ready', onReady);
      player.off('network', onNetwork);
      options.unmountVideoTexture();
      await player.destroy();
    }
  };
}
```

This pattern is intentionally renderer-agnostic. A PSV adapter can map
`mountVideoTexture()` to a live panorama texture; a Cesium adapter can map it to
a material, imagery layer, billboard, or custom primitive.

## CanvasFrameBuffer Pattern

Use `CanvasFrameBuffer` only when the renderer needs a canvas texture or
`captureStream()` output instead of the original video element. It does not do
sphere mapping, 3D projection, or metadata synchronization.

```ts
import { CanvasFrameBuffer } from 'fyraplayer';

const buffer = new CanvasFrameBuffer();

function pump(video: HTMLVideoElement) {
  buffer.renderVideo(video);
  requestAnimationFrame(() => pump(video));
}

pump(videoEl);

const canvas = buffer.getCanvas();
const stream = buffer.getCaptureStream(30);
```

Notes:

- Browser CORS rules still apply when drawing cross-origin media to canvas.
- `captureStream()` is browser-dependent and may add latency.
- Destroy the buffer when the renderer unmounts so capture tracks are stopped.

## PSV / Panorama

Primary owner: `@beeviz/fyrapano` or an app-local PSV bridge.

Recommended adapter behavior:

- create or receive the `HTMLVideoElement` used by FyraPlayer;
- instantiate `FyraPlayer` with normal `Source[]` and optional plugins;
- attach the video or canvas output to PSV as the live texture;
- forward player state, quality state, and diagnostics into PSV UI if needed;
- keep viewport/quality heuristics in the PSV package, not in FyraPlayer.

See [integration-psv.md](./integration-psv.md) and
[livepano-migration.md](./livepano-migration.md) for PSV-specific examples.

## Cesium / Map

Primary owner: `@beeviz/cesium` or an app-local Cesium/map bridge.

Recommended adapter behavior:

- use `HTMLVideoElement` or `CanvasFrameBuffer.getCanvas()` as the texture
  source;
- use `createMetadataPlugin()` or `KlvBridge` to forward KLV/SEI/private data
  into domain parsers such as `@aspect/openklv`;
- map parsed position/attitude/time data into Cesium entities, materials,
  imagery layers, or custom primitives;
- keep camera models, georeferencing, terrain, GIS layers, and UAV
  visualization outside FyraPlayer.

See [integration-cesium.md](./integration-cesium.md) for Cesium-specific
examples.

## Verification Checklist

Before promoting a bridge integration:

- Player reaches `ready` and renderer receives a nonblank texture.
- `destroy()` removes player listeners and renderer resources.
- Source switch replaces the texture without duplicate video/canvas elements.
- Quality/source controls keep working from renderer UI.
- Metadata-driven overlays are timestamped against `player.currentTime` or a
  documented clock source.
- Diagnostics export includes source, Tech, stats, latest network/QoS, and
  renderer-owned context if the product support console needs it.
- Cross-origin video-to-canvas behavior is tested with the real CDN headers.
- A 10 to 30 minute run records memory, media element counts, dropped frames,
  and renderer-specific resource counts.

## Current Status

`CR-026` is closed for the FyraPlayer package boundary: the player exports
generic render-output helpers and documents the external adapter pattern.
Actual PSV, Cesium, map, panorama, and WebGL bridge implementations remain
outside this package and need their own browser verification in the owning
project.
