export interface Mat4 {
  values: Float32Array;
}

const DEG_TO_RAD = Math.PI / 180;

export function degToRad(value: number): number {
  return value * DEG_TO_RAD;
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function wrapDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  let wrapped = value % 360;
  if (wrapped <= -180) wrapped += 360;
  if (wrapped > 180) wrapped -= 360;
  return wrapped;
}

export function identityMat4(): Mat4 {
  return {
    values: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  };
}

export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  const av = a.values;
  const bv = b.values;

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] =
        av[0 * 4 + row] * bv[col * 4 + 0] +
        av[1 * 4 + row] * bv[col * 4 + 1] +
        av[2 * 4 + row] * bv[col * 4 + 2] +
        av[3 * 4 + row] * bv[col * 4 + 3];
    }
  }

  return { values: out };
}

export function perspectiveMat4(fovDeg: number, aspect: number, near = 0.1, far = 100): Mat4 {
  const fov = degToRad(clamp(fovDeg, 1, 179));
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const f = 1 / Math.tan(fov / 2);
  const nf = 1 / (near - far);

  return {
    values: new Float32Array([
      f / safeAspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]),
  };
}

export function rotationMat4(yawDeg: number, pitchDeg: number, rollDeg: number): Mat4 {
  const yaw = degToRad(yawDeg);
  const pitch = degToRad(pitchDeg);
  const roll = degToRad(rollDeg);

  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  const yawMatrix: Mat4 = {
    values: new Float32Array([
      cy, 0, -sy, 0,
      0, 1, 0, 0,
      sy, 0, cy, 0,
      0, 0, 0, 1,
    ]),
  };
  const pitchMatrix: Mat4 = {
    values: new Float32Array([
      1, 0, 0, 0,
      0, cp, sp, 0,
      0, -sp, cp, 0,
      0, 0, 0, 1,
    ]),
  };
  const rollMatrix: Mat4 = {
    values: new Float32Array([
      cr, sr, 0, 0,
      -sr, cr, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
  };

  return multiplyMat4(multiplyMat4(yawMatrix, pitchMatrix), rollMatrix);
}

