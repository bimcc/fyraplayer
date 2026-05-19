import type { PanoramaLiteView } from '../types.js';
import { createViewProjection } from './camera.js';
import { createEquirectSphereMesh, type PanoramaLiteMesh } from './sphereMesh.js';
import { PANORAMA_FRAGMENT_SHADER, PANORAMA_VERTEX_SHADER } from './shaders.js';
import { getTextureSourceSize, isTextureSourceReady, type PanoramaLiteTextureSource } from './texture.js';

export interface PanoramaLiteRendererOptions {
  canvas: HTMLCanvasElement;
  pixelRatio?: number | 'auto';
  maxPixelRatio?: number;
  maxCanvasPixels?: number;
  powerPreference?: WebGLPowerPreference;
  textureFlipX?: boolean;
  textureFlipY?: boolean;
  preserveDrawingBuffer?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export class PanoramaLiteRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly options: PanoramaLiteRendererOptions;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private uvBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private mesh: PanoramaLiteMesh | null = null;
  private viewProjectionLocation: WebGLUniformLocation | null = null;
  private textureLocation: WebGLUniformLocation | null = null;
  private textureTransformLocation: WebGLUniformLocation | null = null;
  private textureSource: PanoramaLiteTextureSource | null = null;
  private textureSize: { width: number; height: number } | null = null;
  private resizeDirty = true;
  private maxTextureSize: number | null = null;
  private destroyed = false;
  private readonly handleContextLost = (event: Event) => {
    event.preventDefault();
    this.options.onContextLost?.();
  };
  private readonly handleContextRestored = () => {
    if (this.destroyed) return;
    this.initialize();
    if (this.textureSource) {
      this.setTextureSource(this.textureSource);
    }
    this.options.onContextRestored?.();
  };

  constructor(options: PanoramaLiteRendererOptions) {
    this.canvas = options.canvas;
    this.options = options;
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.initialize();
  }

  static isSupported(): boolean {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    try {
      return !!canvas.getContext('webgl2');
    } catch {
      return false;
    }
  }

  setTextureSource(source: PanoramaLiteTextureSource): void {
    this.textureSource = source;
    if (!this.gl || !this.texture) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.textureSize = null;
    if (isTextureSourceReady(source)) {
      this.uploadTextureSource(source);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      this.textureSize = { width: 1, height: 1 };
    }
  }

  setTextureTransform(options: { textureFlipX?: boolean; textureFlipY?: boolean }): void {
    if (options.textureFlipX !== undefined) {
      this.options.textureFlipX = options.textureFlipX;
    }
    if (options.textureFlipY !== undefined) {
      this.options.textureFlipY = options.textureFlipY;
    }
  }

  requestResize(): void {
    this.resizeDirty = true;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = this.resolvePixelRatio(rect);
    const width = Math.max(1, Math.floor((rect.width || this.canvas.clientWidth || 1) * ratio));
    const height = Math.max(1, Math.floor((rect.height || this.canvas.clientHeight || 1) * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.gl?.viewport(0, 0, width, height);
    this.resizeDirty = false;
  }

  render(view: PanoramaLiteView, options: { uploadTexture?: boolean } = {}): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || !this.texture || !this.mesh) return;
    if (this.resizeDirty) this.resize();
    if (options.uploadTexture !== false) {
      this.uploadTextureFrame();
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.textureLocation) gl.uniform1i(this.textureLocation, 0);
    if (this.textureTransformLocation) {
      const scaleX = this.options.textureFlipX ? -1 : 1;
      const scaleY = this.options.textureFlipY ? -1 : 1;
      gl.uniform4f(
        this.textureTransformLocation,
        scaleX,
        scaleY,
        this.options.textureFlipX ? 1 : 0,
        this.options.textureFlipY ? 1 : 0
      );
    }
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    if (this.viewProjectionLocation) {
      gl.uniformMatrix4fv(this.viewProjectionLocation, false, createViewProjection(view, aspect));
    }
    gl.drawElements(
      gl.TRIANGLES,
      this.mesh.indices.length,
      this.mesh.indexType === 'uint32' ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      0
    );
    gl.bindVertexArray(null);
  }

  destroy(): void {
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.releaseGlResources();
    this.textureSource = null;
  }

  private initialize(): void {
    this.releaseGlResources();
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: this.options.powerPreference ?? 'high-performance',
      preserveDrawingBuffer: !!this.options.preserveDrawingBuffer,
    });
    if (!gl) {
      throw new Error('WebGL2 is not available');
    }
    this.gl = gl;
    this.mesh = createEquirectSphereMesh();
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.program = this.createProgram(PANORAMA_VERTEX_SHADER, PANORAMA_FRAGMENT_SHADER);
    this.viewProjectionLocation = gl.getUniformLocation(this.program, 'uViewProjection');
    this.textureLocation = gl.getUniformLocation(this.program, 'uTexture');
    this.textureTransformLocation = gl.getUniformLocation(this.program, 'uTextureTransform');
    this.texture = gl.createTexture();
    this.createBuffers();
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    this.resize();
  }

  private createBuffers(): void {
    const gl = this.requireGl();
    const mesh = this.mesh;
    if (!mesh || !this.program) return;
    this.vao = gl.createVertexArray();
    this.vertexBuffer = gl.createBuffer();
    this.uvBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  private uploadTextureFrame(): void {
    const gl = this.gl;
    const source = this.textureSource;
    if (!gl || !this.texture || !source || !isTextureSourceReady(source)) return;
    const maxTextureSize = this.maxTextureSize ?? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    this.maxTextureSize = maxTextureSize;
    const size = getTextureSourceSize(source);
    if (size.width > maxTextureSize || size.height > maxTextureSize) {
      throw new Error(`panoramalite texture exceeds MAX_TEXTURE_SIZE: ${size.width}x${size.height}`);
    }
    this.uploadTextureSource(source, size);
  }

  private uploadTextureSource(source: PanoramaLiteTextureSource, knownSize = getTextureSourceSize(source)): void {
    const gl = this.gl;
    if (!gl || !this.texture) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (!this.textureSize || this.textureSize.width !== knownSize.width || this.textureSize.height !== knownSize.height) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.textureSize = { ...knownSize };
      return;
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.requireGl();
    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create WebGL program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || 'unknown program link error';
      gl.deleteProgram(program);
      throw new Error(info);
    }
    return program;
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.requireGl();
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create WebGL shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'unknown shader compile error';
      gl.deleteShader(shader);
      throw new Error(info);
    }
    return shader;
  }

  private releaseGlResources(): void {
    const gl = this.gl;
    if (!gl) return;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.uvBuffer) gl.deleteBuffer(this.uvBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.program) gl.deleteProgram(this.program);
    this.vao = null;
    this.vertexBuffer = null;
    this.uvBuffer = null;
    this.indexBuffer = null;
    this.texture = null;
    this.textureSize = null;
    this.program = null;
    this.gl = null;
    this.textureTransformLocation = null;
    this.maxTextureSize = null;
    this.resizeDirty = true;
  }

  private requireGl(): WebGL2RenderingContext {
    if (!this.gl) throw new Error('WebGL2 renderer is not initialized');
    return this.gl;
  }

  private resolvePixelRatio(rect: DOMRect | { width: number; height: number }): number {
    const max = this.options.maxPixelRatio ?? 1.5;
    let ratio: number;
    if (typeof this.options.pixelRatio === 'number') {
      ratio = Math.max(0.25, Math.min(max, this.options.pixelRatio));
    } else {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      ratio = Math.max(0.25, Math.min(max, dpr));
    }
    const maxCanvasPixels = this.options.maxCanvasPixels;
    if (typeof maxCanvasPixels === 'number' && Number.isFinite(maxCanvasPixels) && maxCanvasPixels > 0) {
      const cssPixels = Math.max(1, (rect.width || this.canvas.clientWidth || 1) * (rect.height || this.canvas.clientHeight || 1));
      ratio = Math.min(ratio, Math.max(0.25, Math.sqrt(maxCanvasPixels / cssPixels)));
    }
    return ratio;
  }
}
