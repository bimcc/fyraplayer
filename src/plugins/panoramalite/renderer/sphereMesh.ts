export interface PanoramaLiteMesh {
  vertices: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  indexType: 'uint16' | 'uint32';
}

export interface SphereMeshOptions {
  widthSegments?: number;
  heightSegments?: number;
  radius?: number;
}

export function createEquirectSphereMesh(options: SphereMeshOptions = {}): PanoramaLiteMesh {
  const widthSegments = Math.max(8, Math.floor(options.widthSegments ?? 64));
  const heightSegments = Math.max(4, Math.floor(options.heightSegments ?? 32));
  const radius = options.radius ?? 1;

  const vertexCount = (widthSegments + 1) * (heightSegments + 1);
  const vertices = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indexCount = widthSegments * heightSegments * 6;
  const useUint32 = vertexCount > 65535;
  const indices = useUint32 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vertexOffset = 0;
  let uvOffset = 0;

  for (let y = 0; y <= heightSegments; y += 1) {
    const v = y / heightSegments;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let x = 0; x <= widthSegments; x += 1) {
      const u = x / widthSegments;
      const phi = u * Math.PI * 2;
      const sinPhi = Math.sin(phi);
      const cosPhi = Math.cos(phi);

      vertices[vertexOffset] = -radius * sinTheta * sinPhi;
      vertices[vertexOffset + 1] = radius * cosTheta;
      vertices[vertexOffset + 2] = radius * sinTheta * cosPhi;
      vertexOffset += 3;

      uvs[uvOffset] = u;
      uvs[uvOffset + 1] = v;
      uvOffset += 2;
    }
  }

  let indexOffset = 0;
  for (let y = 0; y < heightSegments; y += 1) {
    for (let x = 0; x < widthSegments; x += 1) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      const c = b + 1;
      const d = a + 1;

      indices[indexOffset] = a;
      indices[indexOffset + 1] = b;
      indices[indexOffset + 2] = d;
      indices[indexOffset + 3] = d;
      indices[indexOffset + 4] = b;
      indices[indexOffset + 5] = c;
      indexOffset += 6;
    }
  }

  return {
    vertices,
    uvs,
    indices,
    indexType: useUint32 ? 'uint32' : 'uint16',
  };
}
