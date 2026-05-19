export type PanoramaLiteTextureSource = HTMLVideoElement | HTMLImageElement | ImageBitmap;

export function isTextureSourceReady(source: PanoramaLiteTextureSource): boolean {
  if ('readyState' in source) {
    return source.readyState >= 2 && source.videoWidth > 0 && source.videoHeight > 0;
  }
  if ('complete' in source) {
    return source.complete && source.naturalWidth > 0 && source.naturalHeight > 0;
  }
  return source.width > 0 && source.height > 0;
}

export function getTextureSourceSize(source: PanoramaLiteTextureSource): { width: number; height: number } {
  if ('videoWidth' in source) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  if ('naturalWidth' in source) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

