// h264bsd/Broadway decoder wrapper for WS-raw pipeline.
// Loads Broadway from GitHub (MIT) and exposes decode(nalus: Uint8Array[]): DecodedFrame[].
// DecodedFrame: { width, height, y, u, v } in YUV420.

// Broadway deps
importScripts('https://cdn.jsdelivr.net/gh/mbebenita/Broadway/Player/Decoder.js');

const decoder = new Decoder({
  rgb: true,
  reuseMemory: true,
  filter: 0,
  threads: 1
});

let lastFrame = null;

decoder.onPictureDecoded = function (buffer, width, height) {
  // buffer is RGBA Uint8Array
  const ySize = width * height;
  const uvSize = (width >> 1) * (height >> 1);
  const y = new Uint8Array(ySize);
  const u = new Uint8Array(uvSize);
  const v = new Uint8Array(uvSize);

  // convert RGBA to YUV420 (naive, averaged 2x2 for U/V)
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const idx = (j * width + i) * 4;
      const R = buffer[idx];
      const G = buffer[idx + 1];
      const B = buffer[idx + 2];
      const Y = 0.299 * R + 0.587 * G + 0.114 * B;
      y[j * width + i] = Y;
    }
  }
  for (let j = 0; j < height; j += 2) {
    for (let i = 0; i < width; i += 2) {
      let sumU = 0;
      let sumV = 0;
      for (let dj = 0; dj < 2; dj++) {
        for (let di = 0; di < 2; di++) {
          const x = i + di;
          const yIdx = j + dj;
          const idx = (yIdx * width + x) * 4;
          const R = buffer[idx];
          const G = buffer[idx + 1];
          const B = buffer[idx + 2];
          const U = -0.169 * R - 0.331 * G + 0.5 * B + 128;
          const Vv = 0.5 * R - 0.419 * G - 0.081 * B + 128;
          sumU += U;
          sumV += Vv;
        }
      }
      const uvIdx = (j >> 1) * (width >> 1) + (i >> 1);
      u[uvIdx] = Math.max(0, Math.min(255, Math.round(sumU / 4)));
      v[uvIdx] = Math.max(0, Math.min(255, Math.round(sumV / 4)));
    }
  }
  lastFrame = { width, height, y, u, v };
};

self.decode = function (nalus) {
  try {
    // concat nalus into one AnnexB stream
    let total = 0;
    for (const n of nalus) total += n.byteLength;
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const n of nalus) {
      buf.set(n, offset);
      offset += n.byteLength;
    }
    decoder.decode(buf);
    if (lastFrame) return [lastFrame];
    return [];
  } catch (e) {
    console.error('decode error', e);
    return [];
  }
};
