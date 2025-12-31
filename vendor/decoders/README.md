# Video Decoders (Third-party Runtime Dependencies)

This directory contains pre-compiled video decoders used as fallback when WebCodecs is not available.

## h264bsd/

H.264 software decoder based on Broadway.js (h264bsd).

- **Source**: https://github.com/nicholasareed/nicholasareed.github.io
- **License**: MIT
- **Usage**: Fallback for browsers without WebCodecs support

## h265/ (Reserved)

H.265/HEVC software decoder (to be added).

Candidates:
- libde265.js: https://github.com/nicholasareed/nicholasareed.github.io
- ffmpeg.wasm: https://github.com/nicholasareed/nicholasareed.github.io

## Deployment

Copy this directory to your static assets folder (e.g., `/decoders/`).

Default paths in FyraPlayer:
- H.264: `/decoders/h264bsd/decoder.js`
- H.265: `/decoders/h265/decoder.js`
