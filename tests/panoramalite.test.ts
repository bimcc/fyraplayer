import { createPanoramaLitePlugin } from '../src/plugins/panoramalite.js';
import { DEFAULT_PANORAMA_LIMITS, normalizeView } from '../src/plugins/panoramalite/renderer/camera.js';
import { PanoramaLiteRenderer } from '../src/plugins/panoramalite/renderer/PanoramaLiteRenderer.js';
import { createEquirectSphereMesh } from '../src/plugins/panoramalite/renderer/sphereMesh.js';
import type { EventBusLike, PlayerAPI, PluginContext } from '../src/types.js';

type Handler = (...args: unknown[]) => void;

class BusStub implements EventBusLike {
  readonly emitted: Array<{ event: string; payload?: unknown }> = [];
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, listener: Handler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(listener);
  }

  once(event: string, listener: Handler): void {
    const onceHandler = (...args: unknown[]) => {
      this.off(event, onceHandler);
      listener(...args);
    };
    this.on(event, onceHandler);
  }

  off(event: string, listener: Handler): void {
    this.handlers.get(event)?.delete(listener);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.handlers.delete(event);
      return;
    }
    this.handlers.clear();
  }

  emit(event: string, ...args: unknown[]): void {
    this.emitted.push({ event, payload: args[0] });
    this.handlers.get(event)?.forEach((handler) => handler(...args));
  }
}

class ElementStub {
  readonly style: Record<string, string> = {};
  className = '';
  parentElement: ElementStub | null = null;
  readonly children: ElementStub[] = [];
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  clientWidth = 640;
  clientHeight = 320;

  appendChild<T extends ElementStub>(child: T): T {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    const index = this.parentElement.children.indexOf(this);
    if (index >= 0) this.parentElement.children.splice(index, 1);
    this.parentElement = null;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }

  getBoundingClientRect(): { width: number; height: number } {
    return { width: this.clientWidth, height: this.clientHeight };
  }
}

class CanvasStub extends ElementStub {
  width = 0;
  height = 0;
  constructor(private readonly gl: unknown = null) {
    super();
  }
  getContext(type: string): unknown {
    return type === 'webgl2' ? this.gl : null;
  }
}

class VideoStub extends ElementStub {
  paused = true;
  readyState = 2;
  videoWidth = 1920;
  videoHeight = 960;
}

class WebGL2Stub {
  readonly TEXTURE_2D = 3553;
  readonly UNPACK_FLIP_Y_WEBGL = 37440;
  readonly CLAMP_TO_EDGE = 33071;
  readonly TEXTURE_WRAP_S = 10242;
  readonly TEXTURE_WRAP_T = 10243;
  readonly TEXTURE_MIN_FILTER = 10241;
  readonly TEXTURE_MAG_FILTER = 10240;
  readonly LINEAR = 9729;
  readonly RGBA = 6408;
  readonly UNSIGNED_BYTE = 5121;
  readonly COLOR_BUFFER_BIT = 16384;
  readonly DEPTH_BUFFER_BIT = 256;
  readonly TRIANGLES = 4;
  readonly UNSIGNED_SHORT = 5123;
  readonly UNSIGNED_INT = 5125;
  readonly ARRAY_BUFFER = 34962;
  readonly ELEMENT_ARRAY_BUFFER = 34963;
  readonly STATIC_DRAW = 35044;
  readonly FLOAT = 5126;
  readonly VERTEX_SHADER = 35633;
  readonly FRAGMENT_SHADER = 35632;
  readonly LINK_STATUS = 35714;
  readonly COMPILE_STATUS = 35713;
  readonly MAX_TEXTURE_SIZE = 3379;
  readonly CULL_FACE = 2884;
  readonly DEPTH_TEST = 2929;
  readonly TEXTURE0 = 33984;
  texImage2D = jest.fn();
  texSubImage2D = jest.fn();
  createVertexArray = jest.fn(() => ({}));
  createBuffer = jest.fn(() => ({}));
  createTexture = jest.fn(() => ({}));
  createProgram = jest.fn(() => ({}));
  createShader = jest.fn(() => ({}));
  getUniformLocation = jest.fn(() => ({}));
  getProgramParameter = jest.fn(() => true);
  getShaderParameter = jest.fn(() => true);
  getProgramInfoLog = jest.fn(() => '');
  getShaderInfoLog = jest.fn(() => '');
  getParameter = jest.fn(() => 8192);
  bindTexture = jest.fn();
  pixelStorei = jest.fn();
  texParameteri = jest.fn();
  viewport = jest.fn();
  clearColor = jest.fn();
  clear = jest.fn();
  useProgram = jest.fn();
  bindVertexArray = jest.fn();
  activeTexture = jest.fn();
  uniform1i = jest.fn();
  uniformMatrix4fv = jest.fn();
  drawElements = jest.fn();
  bindBuffer = jest.fn();
  bufferData = jest.fn();
  enableVertexAttribArray = jest.fn();
  vertexAttribPointer = jest.fn();
  disable = jest.fn();
  shaderSource = jest.fn();
  compileShader = jest.fn();
  attachShader = jest.fn();
  linkProgram = jest.fn();
  deleteShader = jest.fn();
  deleteProgram = jest.fn();
  deleteVertexArray = jest.fn();
  deleteBuffer = jest.fn();
  deleteTexture = jest.fn();
}

class PlayerStub implements PlayerAPI {
  readonly currentTime = 0;
  private readonly handlers = new Map<string, Set<Handler>>();
  constructor(private readonly video: HTMLVideoElement) {}
  async play(): Promise<void> {}
  async pause(): Promise<void> {}
  async seek(): Promise<void> {}
  async switchSource(): Promise<void> {}
  getQualityState() { return { supported: false, auto: true, current: null, levels: [] }; }
  async setQualityLevel(): Promise<void> {}
  getState() { return 'idle' as const; }
  getSources() { return []; }
  getCurrentSource() { return undefined; }
  getVideoElement(): HTMLVideoElement { return this.video; }
  async control(): Promise<unknown> { return undefined; }
  enableMetadataExtraction(): void {}
  disableMetadataExtraction(): void {}
  getDetectedPrivateDataPids(): number[] { return []; }
  getDetectedSeiTypes(): number[] { return []; }
  on(event: string, handler: Handler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  once(event: string, handler: Handler): void {
    const onceHandler = (...args: unknown[]) => {
      this.off(event, onceHandler);
      handler(...args);
    };
    this.on(event, onceHandler);
  }
  off(event: string, handler: Handler): void {
    this.handlers.get(event)?.delete(handler);
  }
  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

function createContext(player: PlayerAPI, bus: BusStub): PluginContext {
  return {
    player,
    coreBus: bus,
    techs: {} as PluginContext['techs'],
    storage: null,
  };
}

describe('panoramalite math and mesh', () => {
  test('normalizes yaw and clamps pitch/fov', () => {
    expect(normalizeView({ yaw: 540, pitch: 120, fov: 10 })).toEqual({
      yaw: 180,
      pitch: DEFAULT_PANORAMA_LIMITS.maxPitch,
      roll: 0,
      fov: DEFAULT_PANORAMA_LIMITS.minFov,
    });
  });

  test('creates equirectangular sphere mesh with expected sizes', () => {
    const mesh = createEquirectSphereMesh({ widthSegments: 16, heightSegments: 8 });
    expect(mesh.vertices).toHaveLength((16 + 1) * (8 + 1) * 3);
    expect(mesh.uvs).toHaveLength((16 + 1) * (8 + 1) * 2);
    expect(mesh.indices).toHaveLength(16 * 8 * 6);
    expect(mesh.indexType).toBe('uint16');
  });
});

describe('PanoramaLiteRenderer', () => {
  test('allocates a real video texture after a 1x1 placeholder', () => {
    const gl = new WebGL2Stub();
    const canvas = new CanvasStub(gl);
    Object.defineProperty(globalThis, 'document', {
      value: { createElement: () => new CanvasStub(gl) },
      configurable: true,
    });

    const renderer = new PanoramaLiteRenderer({ canvas: canvas as unknown as HTMLCanvasElement, pixelRatio: 1 });
    const video = new VideoStub() as unknown as HTMLVideoElement;

    Object.defineProperty(video, 'readyState', { value: 0, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 0, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 0, configurable: true });
    renderer.setTextureSource(video);
    expect(gl.texImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      expect.any(Uint8Array)
    );

    Object.defineProperty(video, 'readyState', { value: 2, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 960, configurable: true });
    renderer.render({ yaw: 0, pitch: 0, roll: 0, fov: 80 });

    expect(gl.texImage2D).toHaveBeenLastCalledWith(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    expect(gl.texSubImage2D).not.toHaveBeenCalled();

    renderer.render({ yaw: 0, pitch: 0, roll: 0, fov: 80 });
    expect(gl.texSubImage2D).toHaveBeenCalledWith(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
  });
});

describe('createPanoramaLitePlugin', () => {
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalWindow = globalThis.window;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: originalHTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true });
    Object.defineProperty(globalThis, 'requestAnimationFrame', { value: originalRequestAnimationFrame, configurable: true });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: originalCancelAnimationFrame, configurable: true });
  });

  test('emits unsupported qos when document is unavailable', () => {
    Object.defineProperty(globalThis, 'document', { value: undefined, configurable: true });
    const bus = new BusStub();
    const video = new VideoStub() as unknown as HTMLVideoElement;

    createPanoramaLitePlugin()(createContext(new PlayerStub(video), bus));

    expect(bus.emitted).toContainEqual({
      event: 'qos',
      payload: expect.objectContaining({ code: 'PANORAMALITE_UNSUPPORTED' }),
    });
  });

  test('cleans up host canvas when renderer initialization fails', () => {
    const host = new ElementStub();
    const video = new VideoStub();
    host.appendChild(video);
    const createdCanvases: CanvasStub[] = [];
    let webglContextCalls = 0;
    const documentStub = {
      visibilityState: 'visible',
      querySelector: (selector: string) => selector === '.host' ? host : null,
      createElement: (tagName: string) => {
        if (tagName === 'canvas') {
          const canvas = new CanvasStub({
            createVertexArray: () => {
              throw new Error('renderer init failed');
            },
          });
          const originalGetContext = canvas.getContext.bind(canvas);
          canvas.getContext = (type: string): unknown => {
            webglContextCalls += 1;
            return webglContextCalls === 1 ? {} : originalGetContext(type);
          };
          createdCanvases.push(canvas);
          return canvas;
        }
        return new ElementStub();
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: ElementStub, configurable: true });
    Object.defineProperty(globalThis, 'requestAnimationFrame', { value: (cb: FrameRequestCallback) => { cb(0); return 1; }, configurable: true });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: jest.fn(), configurable: true });

    const bus = new BusStub();
    const player = new PlayerStub(video as unknown as HTMLVideoElement);
    const onError = jest.fn();

    const lifecycle = createPanoramaLitePlugin({ target: '.host', onError })(createContext(player, bus));

    expect(lifecycle).toBeUndefined();
    expect(onError).toHaveBeenCalled();
    expect(bus.emitted).toContainEqual({
      event: 'qos',
      payload: expect.objectContaining({ code: 'PANORAMALITE_RENDER_ERROR' }),
    });
    expect(createdCanvases).toHaveLength(2);
    expect(host.children).not.toContain(createdCanvases[1]);
    expect(host.style.position).toBe('');
    expect(player.listenerCount('ready')).toBe(0);
  });

  test('emits unsupported qos when WebGL2 is unavailable', () => {
    const host = new ElementStub();
    const video = new VideoStub();
    host.appendChild(video);
    const documentStub = {
      visibilityState: 'visible',
      querySelector: () => host,
      createElement: (tagName: string) => tagName === 'canvas' ? new CanvasStub(null) : new ElementStub(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: ElementStub, configurable: true });

    const bus = new BusStub();
    const onError = jest.fn();

    createPanoramaLitePlugin({ target: '.host', onError })(createContext(new PlayerStub(video as unknown as HTMLVideoElement), bus));

    expect(onError).toHaveBeenCalled();
    expect(bus.emitted).toContainEqual({
      event: 'qos',
      payload: expect.objectContaining({ code: 'PANORAMALITE_UNSUPPORTED' }),
    });
  });

  test('restores host and video styles on destroy', () => {
    const gl = new WebGL2Stub();
    const host = new ElementStub();
    host.style.position = '';
    const video = new VideoStub();
    host.appendChild(video);
    const documentStub = {
      visibilityState: 'visible',
      querySelector: () => host,
      createElement: (tagName: string) => tagName === 'canvas' ? new CanvasStub(gl) : new ElementStub(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      body: new ElementStub(),
    };
    Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: ElementStub, configurable: true });
    Object.defineProperty(globalThis, 'window', {
      value: { getComputedStyle: () => ({ position: 'static' }), devicePixelRatio: 1 },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'requestAnimationFrame', { value: () => 1, configurable: true });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { value: jest.fn(), configurable: true });

    video.style.visibility = 'visible';
    video.style.opacity = '1';
    const lifecycle = createPanoramaLitePlugin({ target: '.host' })(
      createContext(new PlayerStub(video as unknown as HTMLVideoElement), new BusStub())
    );

    expect(lifecycle).toBeDefined();
    expect(host.style.position).toBe('relative');
    expect(video.style.visibility).toBe('hidden');
    expect(host.children.length).toBe(2);

    lifecycle?.destroy?.();

    expect(host.style.position).toBe('');
    expect(video.style.visibility).toBe('visible');
    expect(video.style.opacity).toBe('1');
    expect(host.children).toEqual([video]);
  });
});
