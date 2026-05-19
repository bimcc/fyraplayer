export async function loadPanoramaImage(image: string | HTMLImageElement | ImageBitmap): Promise<HTMLImageElement | ImageBitmap> {
  if (typeof image !== 'string') return image;
  if (typeof Image === 'undefined') {
    throw new Error('Image constructor is not available in this environment');
  }
  const element = new Image();
  element.crossOrigin = 'anonymous';
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error(`Failed to load panorama image: ${image}`));
  });
  element.src = image;
  return promise;
}

