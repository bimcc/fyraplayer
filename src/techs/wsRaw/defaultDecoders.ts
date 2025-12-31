// WS-raw 默认解码器资源路径（需前端自行部署 wasm/js）
// 将 wasm+js 放在 public/decoders 下即可被本地 HTTP 服务访问，可按需扩展多个版本（安全/极速）

export const DEFAULT_H264_DECODER_URL = '/decoders/h264bsd/decoder.js';
export const DEFAULT_H264_DECODER_CANDIDATES = [
  '/decoders/h264bsd/decoder.js', // 安全/默认
  '/decoders/h264bsd/decoder-fast.js' // 预留极速版本（存在时可切换）
];

// H.265 wasm 解码器（可选，需部署对应 worker/wasm）
export const DEFAULT_H265_DECODER_URL = '/decoders/h265/decoder.js';
