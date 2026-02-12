# Migrating livepano to FyraPlayer

Goal: replace livepano’s self-managed playback engines with FyraPlayer while keeping PSV plugin/UI logic.

## What to swap
- Playback: remove/customize livepano PlaybackEngines; use FyraPsvAdapter (or FyraPsvPlugin via createFyraPsvPlugin).
- URL resolution: reuse/migrate EngineFactory & engines (zlm/srs/mediamtx/monibuca/oven/tencent) now in `src/plugins/engines/`. Call `registerDefaultEngines()` and `EngineFactory.convertUrl(...)` to produce Fyra Sources + fallbackChain.
- Rendering/UI: keep PSV plugin lifecycle, viewport tracker, quality heuristics; just feed it with Fyra’s video/canvas.

## Steps
1) Register engines (optional):
   ```ts
   import { EngineFactory, registerDefaultEngines } from 'fyraplayer/plugins/engines';
   registerDefaultEngines();
   EngineFactory.setConfig({ mediamtx: { host: '...', useHttps: false } });
   const urls = EngineFactory.convertUrl('mediamtx', 'rtsp://host/app/stream');
   const sources = [
     { type: 'webrtc', url: urls.webrtcUrl, signal: { type: 'whep', url: urls.whepUrl } },
     { type: 'ws-raw', url: urls.wsFlvUrl, codec: 'h264', transport: 'flv' },
     { type: 'hls', url: urls.hlsUrl }
   ];
   ```
2) Replace playback init:
   - Before: new PlaybackEngines(video, config).start(...)
   - After: create PSV plugin with FyraPsvAdapter / createFyraPsvPlugin, pass `video` (hidden), `sources`, `techOrder`.
3) RTMP/RTSP auto-convert:
   - Use EngineFactory.convertUrl(engineName, inputUrl) to get webrtc/ws-flv/hls/dash URLs.
   - Build Fyra `Source[]` from those URLs; keep `fallbackChain` as `techOrder`.
4) Direct playback (no convert):
   - Allow user to enter a direct URL and choose type; map to Fyra Source (hls/dash/ws-raw/webrtc/file).
5) Optional: VideoFrame hook for low-latency panorama
   - For ws-raw, set frame hook: `((tech as WSRawTech).setFrameHook((frame) => ...))` to feed custom sphere mapper if you bypass <video>.
6) Metadata/KLV (if used):
   - Enable `metadata` on ws-raw sources (ts transport) and bridge to `@beeviz/klv` via `KlvBridge`.

## What stays in livepano
- PSV UI/plugin lifecycle, viewportTracker, quality/bitrate heuristics.
- Engine configs UI (host/port/protocol) feeding into EngineFactory.
- Controls (play/pause/error handling) now call Fyra Player API.

## Packaging
- Use `createFyraPsvPlugin(PhotoSphereViewer)` and register it in livepano; no PSV dependency baked into Fyra.
- Keep engine adapters optional; tree-shake or split bundle if you don’t need all engines.
