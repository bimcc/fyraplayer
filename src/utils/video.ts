export function resolveVideoElement(el: HTMLVideoElement | string): HTMLVideoElement {
  if (typeof el !== 'string') return el;
  const found = document.querySelector(el);
  if (!found) {
    throw new Error(`video element not found by selector: ${el}`);
  }
  if (!(found instanceof HTMLVideoElement)) {
    throw new Error(`selector ${el} did not return a video element`);
  }
  return found;
}
