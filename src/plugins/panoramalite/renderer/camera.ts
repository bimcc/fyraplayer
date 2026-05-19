import type { PanoramaLiteView, PanoramaLiteViewLimits } from '../types.js';
import { clamp, multiplyMat4, perspectiveMat4, rotationMat4, wrapDegrees } from './math.js';

export const DEFAULT_PANORAMA_VIEW: PanoramaLiteView = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  fov: 80,
};

export const DEFAULT_PANORAMA_LIMITS: PanoramaLiteViewLimits = {
  minPitch: -85,
  maxPitch: 85,
  minFov: 35,
  maxFov: 110,
};

export function normalizeView(
  view: Partial<PanoramaLiteView> | undefined,
  limits: PanoramaLiteViewLimits = DEFAULT_PANORAMA_LIMITS,
  base: PanoramaLiteView = DEFAULT_PANORAMA_VIEW
): PanoramaLiteView {
  const yaw = typeof view?.yaw === 'number' ? view.yaw : base.yaw;
  const pitch = typeof view?.pitch === 'number' ? view.pitch : base.pitch;
  const roll = typeof view?.roll === 'number' ? view.roll : base.roll;
  const fov = typeof view?.fov === 'number' ? view.fov : base.fov;

  return {
    yaw: wrapDegrees(yaw),
    pitch: clamp(pitch, limits.minPitch, limits.maxPitch),
    roll: wrapDegrees(roll),
    fov: clamp(fov, limits.minFov, limits.maxFov),
  };
}

export function mergeLimits(limits?: Partial<PanoramaLiteViewLimits>): PanoramaLiteViewLimits {
  const merged = {
    ...DEFAULT_PANORAMA_LIMITS,
    ...limits,
  };
  if (merged.minPitch > merged.maxPitch) {
    [merged.minPitch, merged.maxPitch] = [merged.maxPitch, merged.minPitch];
  }
  if (merged.minFov > merged.maxFov) {
    [merged.minFov, merged.maxFov] = [merged.maxFov, merged.minFov];
  }
  return merged;
}

export function createViewProjection(view: PanoramaLiteView, aspect: number): Float32Array {
  const projection = perspectiveMat4(view.fov, aspect);
  const rotation = rotationMat4(-view.yaw, -view.pitch, -view.roll);
  return multiplyMat4(projection, rotation).values;
}

