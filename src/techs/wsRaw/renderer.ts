import { DecodedFrame } from './decoderWorker.js';

/**
 * Renderer: WebGL YUV->RGB with DPR-aware sizing; fallback to Canvas2D.
 */
export class Renderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private textures: WebGLTexture[] = [];
  private planeSizes: { w: number; h: number }[] = [];
  private uvPacked: Uint8Array | null = null;
  private buffer: WebGLBuffer | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;
  private stream: MediaStream | null = null;
  private usingCapture = false;
  private dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1)); // 限制 DPR，4K 时减压
  private targetCssWidth = 0;
  private targetCssHeight = 0;
  private smooth = false; // linear filtering if true, default NEAREST for sharpness/perf
  private maxTextureDim = 4096;
  private align = 64; // 纹理尺寸向上对齐，减少频繁重分配

  constructor(private videoEl: HTMLVideoElement) {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.maxWidth = '100%';
    this.canvas = canvas;

    const parent = videoEl.parentElement;
    if (parent) {
      if (!parent.style.position) parent.style.position = 'relative';
      parent.insertBefore(canvas, videoEl);
    } else {
      document.body.appendChild(canvas);
    }

    this.stream = (canvas as any).captureStream ? (canvas as any).captureStream(30) : null;
    if (this.stream) {
      this.usingCapture = true;
      videoEl.srcObject = this.stream;
      // NOTE: Do NOT set videoEl.controls = true here!
      // The UI skin plugin will manage controls visibility.
      // Setting controls here causes "double controls" when skin is enabled.
      videoEl.play?.().catch(() => {});
    }

    // 仅使用 WebGL2，禁用 antialias 减少 fillrate，适配高 DPR
    this.gl = canvas.getContext('webgl2', { premultipliedAlpha: false, antialias: false }) as WebGL2RenderingContext | null;
    if (this.gl) {
      this.initGL();
    } else {
      this.ctx2d = canvas.getContext('2d');
    }
  }

  private initGL(): void {
    if (!this.gl) return;
    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      uniform sampler2D u_textureY;
      uniform sampler2D u_textureUV; // RG packed UV
      void main() {
        float y = texture2D(u_textureY, v_texCoord).r;
        vec2 uv = texture2D(u_textureUV, v_texCoord).rg - vec2(0.5, 0.5);
        float u = uv.x;
        float v = uv.y;
        float r = y + 1.402 * v;
        float g = y - 0.344136 * u - 0.714136 * v;
        float b = y + 1.772 * u;
        gl_FragColor = vec4(r, g, b, 1.0);
      }
    `;
    const gl = this.gl;
    const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return;
    const program = this.createProgram(gl, vs, fs);
    if (!program) return;
    this.program = program;
    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    const texLoc = gl.getAttribLocation(program, 'a_texCoord');
    const buffer = gl.createBuffer();
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 0,
         1, -1, 1, 0,
        -1,  1, 0, 1,
         1,  1, 1, 1
      ]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texLoc);
    gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

    const yLoc = gl.getUniformLocation(program, 'u_textureY');
    const uvLoc = gl.getUniformLocation(program, 'u_textureUV');

    const filter = this.smooth ? gl.LINEAR : gl.NEAREST;
    for (let i = 0; i < 2; i++) {
      const tex = gl.createTexture();
      if (!tex) continue;
      this.textures.push(tex);
      this.planeSizes.push({ w: 0, h: 0 });
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.uniform1i(yLoc, 0);
    gl.uniform1i(uvLoc, 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.clearColor(0, 0, 0, 1);
    gl.getExtension('EXT_color_buffer_float'); // 尝试提升精度
    this.maxTextureDim = gl.getParameter(gl.MAX_TEXTURE_SIZE) || this.maxTextureDim;
  }

  private resize(width: number, height: number): void {
    // 实时更新 DPR，防止窗口拖动/缩放时模糊
    this.dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const cssW = this.videoEl.clientWidth || width;
    const cssH = this.videoEl.clientHeight || height;
    this.targetCssWidth = cssW;
    this.targetCssHeight = cssH;
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  renderFrame(frame: VideoFrame): void {
    if (this.gl && this.program) {
      this.resize(frame.codedWidth, frame.codedHeight);
      // Many browsers don't expose VideoFrame upload to WebGL; fallback to 2D draw.
      this.ctx2d = this.ctx2d || this.canvas.getContext('2d');
      // @ts-ignore
      this.ctx2d?.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
      this.ensureAttached();
      return;
    }
    if (!this.ctx2d) return;
    this.resize(frame.codedWidth, frame.codedHeight);
    // @ts-ignore drawImage VideoFrame
    this.ctx2d.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    this.ensureAttached();
  }

  render(frames: DecodedFrame[]): void {
    if (!frames.length) return;
    if (this.gl && this.program) {
      const f = frames[frames.length - 1];
      this.resize(f.width, f.height);
      this.renderDecodedGL(f);
      return;
    }
    if (!this.ctx2d) return;
    const frame = frames[frames.length - 1];
    this.resize(frame.width, frame.height);
    if (!this.imageData || this.imageData.width !== frame.width || this.imageData.height !== frame.height) {
      this.imageData = this.ctx2d.createImageData(frame.width, frame.height);
    }
    this.yuvToRgba(frame, this.imageData!.data);
    this.ctx2d.putImageData(this.imageData!, 0, 0);
    this.ensureAttached();
  }

  private renderDecodedGL(frame: DecodedFrame): void {
    if (!this.gl || !this.program || this.textures.length < 2) return;
    const { gl } = this;
    const { width, height, y, u, v } = frame;
    this.resize(width, height);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.disable(gl.DITHER);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.uploadPlane(0, width, height, y);
    // pack UV -> RG8 to减少绑定
    const uvW = width >> 1;
    const uvH = height >> 1;
    const needed = uvW * uvH * 2;
    if (!this.uvPacked || this.uvPacked.byteLength !== needed) {
      this.uvPacked = new Uint8Array(needed);
    }
    let p = 0;
    for (let i = 0; i < uvW * uvH; i++) {
      this.uvPacked[p++] = u[i];
      this.uvPacked[p++] = v[i];
    }
    this.uploadPlane(1, uvW, uvH, this.uvPacked, gl.RG);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.ensureAttached();
  }

  private uploadPlane(idx: number, w: number, h: number, data: Uint8Array, fmtOverride?: number): void {
    if (!this.gl || !this.textures[idx]) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + idx);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[idx]);
    const plane = this.planeSizes[idx] || { w: 0, h: 0 };
    const fmt = fmtOverride ?? (gl as WebGL2RenderingContext).RED;
    const internalFmt = fmt === gl.RG ? gl.RG8 : gl.R8;
    const targetW = Math.min(this.maxTextureDim, Math.max(plane.w, this.alignSize(w)));
    const targetH = Math.min(this.maxTextureDim, Math.max(plane.h, this.alignSize(h)));
    if (plane.w === 0 || plane.h === 0 || targetW !== plane.w || targetH !== plane.h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFmt, targetW, targetH, 0, fmt, gl.UNSIGNED_BYTE, null);
      this.planeSizes[idx] = { w: targetW, h: targetH };
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, fmt, gl.UNSIGNED_BYTE, data);
  }

  private ensureAttached(): void {
    if (this.usingCapture && this.stream && this.videoEl.srcObject !== this.stream) {
      this.videoEl.srcObject = this.stream;
    }
  }

  destroy(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.gl) {
      this.textures.forEach((t) => this.gl?.deleteTexture(t));
      if (this.buffer) this.gl.deleteBuffer(this.buffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }
    this.gl = null;
    this.program = null;
    this.textures = [];
    this.ctx2d = null;
    this.imageData = null;
    if (this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
  }

  private yuvToRgba(frame: DecodedFrame, out: Uint8ClampedArray): void {
    const { width, height, y, u, v } = frame;
    let idx = 0;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const yIdx = j * width + i;
        const uvIdx = Math.floor(j / 2) * Math.floor(width / 2) + Math.floor(i / 2);
        const Y = y[yIdx];
        const U = u[uvIdx];
        const V = v[uvIdx];
        const R = Y + 1.402 * (V - 128);
        const G = Y - 0.344136 * (U - 128) - 0.714136 * (V - 128);
        const B = Y + 1.772 * (U - 128);
        out[idx++] = this.clamp(R);
        out[idx++] = this.clamp(G);
        out[idx++] = this.clamp(B);
        out[idx++] = 255;
      }
    }
  }

  private createShader(gl: WebGLRenderingContext | WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('[renderer] shader compile error', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[renderer] program link error', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  private clamp(val: number): number {
    return val < 0 ? 0 : val > 255 ? 255 : val;
  }

  private alignSize(v: number): number {
    return Math.ceil(v / this.align) * this.align;
  }
}
