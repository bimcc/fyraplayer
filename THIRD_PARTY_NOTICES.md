# Third-party notices

FyraPlayer source is MIT licensed; that license does not replace licenses for third-party code.

- The standalone IIFE bundle includes hls.js (Apache-2.0). Its copyright notices and the Apache 2.0 license text are distributed under `dist/licenses/`.
- `dist/vendor/dash.all.min.js` is the optional dash.js browser distribution (BSD-3-Clause). Its upstream license and extracted bundle notices are included beside it and under `dist/licenses/`.
- ESM consumers resolve hls.js as a dependency. Optional mpegts.js, dashjs and mp4box packages supplied by the host retain their own license terms and notices.

`pnpm build` copies notices from the installed dependency versions, so they track the lockfile. Preserve these files when redistributing the IIFE or DASH vendor assets.
