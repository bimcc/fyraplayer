# FyraPlayer SDK Release And Integration

> Purpose: keep the SDK consumption path explicit for ESM, plugin subpaths, and
> browser IIFE delivery.

## Build Outputs

- `pnpm build` generates the ESM package in `dist/`.
- `pnpm bundle:iife` generates `dist/fyraplayer.iife.js`.
- `pnpm build:release` runs both steps in sequence.
- `pnpm bundle:examples` rebuilds the demo bundle used by `examples/basic.html`
  from `examples/app.ts`.

Supported example assets for 1.0 are intentionally small:

- `examples/basic.html`: the primary ESM demo and protocol playground.
- `examples/sources.js`: the checked source preset manifest used by the demo.
- `examples/minimal-iife.html`: the no-build browser/IIFE integration smoke.

Older standalone HLS debug pages and placeholder PSV/Cesium HTML demos were
removed from `examples/` because they bypassed the current SDK integration path
or pointed at external renderer packages that now have their own ownership
boundary. Use `docs/render-bridges.md`, `docs/integration-psv.md`, and
`docs/integration-cesium.md` for renderer guidance instead.

## Public Entry Points

The supported package entry points are the paths listed in `package.json`
`exports`. Product integrations should not import from `src/*` or `dist/*`
internals.

| Entry | Use |
|---|---|
| `fyraplayer` | Core player, types, built-in Techs, core utilities |
| `fyraplayer/plugins` | Aggregate optional plugin entry for convenience |
| `fyraplayer/plugins/ui-components` | Optional player controls shell |
| `fyraplayer/plugins/recording-api` | Backend recording start/stop/status adapter |
| `fyraplayer/plugins/auth` | Request/signaling auth, signing middleware, and optional auth recovery helper |
| `fyraplayer/plugins/diagnostics` | Snapshot/export/debug panel plugin |
| `fyraplayer/plugins/storage` | Playback preference persistence |
| `fyraplayer/plugins/reconnect` | Reconnect event logging/callback helper |
| `fyraplayer/plugins/metrics` | Metrics reporter plugin |
| `fyraplayer/plugins/performance` | Performance budget monitor |
| `fyraplayer/plugins/engines` | Streaming-server URL/source adapters |
| `fyraplayer/plugins/metadata` | KLV/SEI/private-data metadata bridge |

Backend recording is exposed only through `fyraplayer/plugins/recording-api`.

Renderer bridge note: PSV, Cesium, map, and panorama adapters are not package
entrypoints in `fyraplayer`. The main package exports generic helpers such as
`CanvasFrameBuffer` and `BaseTarget`; concrete renderer bridges should live in
packages such as `@beeviz/fyrapano`, `@beeviz/cesium`, or app-local adapters.
Use `docs/render-bridges.md` as the integration boundary.

## Consumption Modes

### 1. ESM Import

```typescript
import { FyraPlayer } from 'fyraplayer';
import { createUiComponentsPlugin } from 'fyraplayer/plugins/ui-components';
import { createRecordingApiPlugin } from 'fyraplayer/plugins/recording-api';
```

Use this path for modern bundlers, SSR-aware applications, and product code that
already has a build pipeline.

### 2. Browser IIFE

The release bundle exposes an all-in-one `window.FyraPlayerSDK` for no-build
browser integrations. ESM consumers should still prefer the package subpaths
above for tree-shaking.

```html
<script src="../dist/fyraplayer.iife.js"></script>
<script>
  const {
    FyraPlayer,
    createUiComponentsPlugin,
    createRecordingApiPlugin,
    createDiagnosticsPlugin,
    createAuthSigningMiddleware,
    createAuthRecoveryPlugin
  } = window.FyraPlayerSDK;
</script>
```

See `examples/minimal-iife.html` for a minimal working page.

### 3. Optional Plugin Subpaths

Keep optional features outside the core import:

- `fyraplayer/plugins/ui-components`
- `fyraplayer/plugins/recording-api`
- `fyraplayer/plugins/auth`
- `fyraplayer/plugins/diagnostics`
- `fyraplayer/plugins/storage`
- `fyraplayer/plugins/reconnect`
- `fyraplayer/plugins/metrics`
- `fyraplayer/plugins/performance`
- `fyraplayer/plugins/engines`
- `fyraplayer/plugins/metadata`

## Release Checklist

Run this checklist before tagging or publishing a commercial SDK build:

1. Update `CHANGELOG.md` under `Unreleased` or the target version.
2. Confirm `docs/supported-scenarios.md` does not over-claim browser/protocol
   support beyond `docs/playback-verification-matrix.md`.
3. Run `pnpm check:release` to execute the release self-check sequence.
4. Open `examples/minimal-iife.html` from a local static server after
   `pnpm check:release` and confirm `window.FyraPlayerSDK.FyraPlayer` exists.
5. Record any new manual browser/protocol evidence in
   `docs/playback-verification-matrix.md`.
6. Keep release notes explicit about conditional items such as WebRTC
   Opus/TURN/recovery, direct fMP4 real-stream evidence, DRM, subtitles, ads,
   and business analytics.

For the 1.0 commercial baseline, also review
`docs/release-1.0-readiness.md` before tagging or publishing.

## Version Policy

- `patch`: bug fixes, doc fixes, and non-breaking behavior clarifications.
- `minor`: additive APIs, new plugins, new events, and new demo assets.
- `major`: breaking API, export-map, or lifecycle contract changes.

Do not publish a release until the release notes mention:

- supported playback scenarios and known limitations;
- newly added plugins or event codes;
- browser/browser-version evidence where relevant;
- any breaking integration changes.

## Migration Notes

- Import from package exports, not `src/*` paths.
- Prefer plugin factory functions over default singleton exports in production.
- Use `createRecordingApiPlugin()` for backend recording control.
- Do not treat UI recording toggles as browser-side recording.
- Keep WHEP/WHIP timeout and ICE settings in the source config when validating
  live WebRTC deployments.
- Keep optional UI, diagnostics, auth/signing, storage, performance, metadata,
  and recording concerns pluginized unless the core playback contract truly
  requires them.
