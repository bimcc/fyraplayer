import type { EventBusLike, PlayerAPI, PluginCtor } from '../../types.js';
import type {
  PanoramaLiteHandle,
  PanoramaLitePluginOptions,
  PanoramaLiteQosCode,
  PanoramaLiteQosPayload,
  PanoramaLiteView,
  PanoramaLiteViewLimits,
} from './types.js';
import { DEFAULT_PANORAMA_VIEW, mergeLimits, normalizeView } from './renderer/camera.js';
import { PanoramaLiteRenderer } from './renderer/PanoramaLiteRenderer.js';
import { loadPanoramaImage } from './media/imageLoader.js';
import { createPanoramaLiteControls, type PanoramaLiteControls } from './input/controls.js';
import { createPanoramaLiteViewerControls, type PanoramaLiteViewerControls } from './viewerControls.js';

type VideoFrameRequestCallback = (now: number, metadata: unknown) => void;
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const PLUGIN_CLASS = 'fyra-panoramalite';

export function createPanoramaLitePlugin(options: PanoramaLitePluginOptions = {}): PluginCtor {
  return ({ player, coreBus }) => {
    if (typeof document === 'undefined') {
      const error = new Error('PanoramaLite requires a DOM document');
      emitQos(coreBus, 'PANORAMALITE_UNSUPPORTED', 'warning', error.message);
      options.onError?.(error);
      return;
    }
    if (!PanoramaLiteRenderer.isSupported()) {
      const error = new Error('WebGL2 is not available');
      emitQos(coreBus, 'PANORAMALITE_UNSUPPORTED', 'warning', error.message);
      options.onError?.(error);
      return;
    }

    let instance: PanoramaLiteInstance | null = null;
    try {
      instance = new PanoramaLiteInstance(player, coreBus, options);
      options.onReady?.(instance.handle);
      return {
        destroy: () => instance?.destroy(),
      };
    } catch (error) {
      const code = error instanceof Error && error.message === 'WebGL2 is not available'
        ? 'PANORAMALITE_UNSUPPORTED'
        : 'PANORAMALITE_RENDER_ERROR';
      emitQos(coreBus, code, 'warning', getErrorMessage(error));
      options.onError?.(error);
      return;
    }
  };
}

class PanoramaLiteInstance {
  private readonly player: PlayerAPI;
  private readonly coreBus: EventBusLike;
  private readonly options: PanoramaLitePluginOptions;
  private readonly limits: PanoramaLiteViewLimits;
  private readonly initialView: PanoramaLiteView;
  private readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly renderer: PanoramaLiteRenderer;
  private controls: PanoramaLiteControls | null = null;
  private viewerControls: PanoramaLiteViewerControls | null = null;
  private view: PanoramaLiteView;
  private video: VideoWithFrameCallback | null = null;
  private readonly minVideoFrameIntervalMs: number;
  private lastVideoRenderAt = 0;
  private lastPresentedFrames: number | null = null;
  private lastVideoMediaTime: number | null = null;
  private videoFrameDirty = false;
  private rafId: number | null = null;
  private videoFrameId: number | null = null;
  private pendingRenderUpload = false;
  private destroyed = false;
  private enabled: boolean;
  private interactiveEnabled: boolean;
  private resizeObserver: ResizeObserver | null = null;
  private previousVideoVisibility: { visibility?: string; opacity?: string; pointerEvents?: string } | null = null;
  private previousHostPosition: string | null = null;
  private readonly videoEventHandlers: Array<{ event: string; handler: EventListener }> = [];
  private readonly onReady = () => this.rebindCurrentVideo();
  private readonly onPlay = () => {
    this.scheduleRender();
    this.scheduleVideoFrameLoop();
  };
  private readonly onPause = () => this.scheduleRender();
  private readonly onVisibilityChange = () => {
    if (isDocumentHidden()) {
      this.cancelRenderScheduling();
      return;
    }
    this.scheduleRender();
    this.scheduleVideoFrameLoop();
  };

  readonly handle: PanoramaLiteHandle = {
    setEnabled: (enabled) => this.setEnabled(enabled),
    isEnabled: () => this.enabled,
    setView: (view) => this.setView(view),
    getView: () => ({ ...this.view }),
    resetView: () => this.setView(this.initialView),
    bindVideo: (video) => this.bindVideo(video),
    setImage: (image) => this.setImage(image),
    setInteractive: (enabled) => this.setInteractive(enabled),
    resize: () => this.resize(),
    destroy: () => this.destroy(),
  };

  constructor(player: PlayerAPI, coreBus: EventBusLike, options: PanoramaLitePluginOptions) {
    this.player = player;
    this.coreBus = coreBus;
    this.options = options;
    this.enabled = options.enabled !== false;
    this.interactiveEnabled = options.interactive !== false;
    this.limits = mergeLimits(options.limits);
    this.initialView = normalizeView(options.initialView, this.limits, DEFAULT_PANORAMA_VIEW);
    this.view = { ...this.initialView };
    this.minVideoFrameIntervalMs = resolveVideoFrameIntervalMs(options.maxVideoFps);
    this.host = resolveTarget(options.target, player.getVideoElement());
    this.canvas = document.createElement('canvas');
    this.canvas.className = [PLUGIN_CLASS, options.className].filter(Boolean).join(' ');
    this.ensureHostPositioning();
    this.applyCanvasStyle();
    this.host.appendChild(this.canvas);
    try {
      this.renderer = new PanoramaLiteRenderer({
        canvas: this.canvas,
        pixelRatio: options.pixelRatio ?? 'auto',
        maxPixelRatio: options.maxPixelRatio ?? 1.5,
        maxCanvasPixels: options.maxCanvasPixels,
        powerPreference: options.powerPreference,
        textureFlipX: resolveTextureFlipX(options),
        textureFlipY: resolveTextureFlipY(options),
        preserveDrawingBuffer: !!options.preserveDrawingBuffer,
        onContextLost: () => emitQos(this.coreBus, 'PANORAMALITE_CONTEXT_LOST', 'warning', 'PanoramaLite WebGL context lost'),
        onContextRestored: () => {
          emitQos(this.coreBus, 'PANORAMALITE_CONTEXT_RESTORED', 'info', 'PanoramaLite WebGL context restored');
          this.scheduleRender();
        },
      });
    } catch (error) {
      this.canvas.remove();
      this.restoreHostPositioning();
      throw error;
    }
    this.observeResize();
    this.controls = createPanoramaLiteControls({
      element: this.canvas,
      getView: () => this.view,
      setView: (view) => this.setView(view),
      enabled: this.interactiveEnabled,
    });
    this.viewerControls = createPanoramaLiteViewerControls({
      host: this.host,
      video: player.getVideoElement(),
      media: options.media ?? 'video',
      options: options.viewerControls,
      play: () => this.player.play(),
      pause: () => this.player.pause(),
      resetView: () => this.handle.resetView(),
      resize: () => this.resize(),
      onError: (error) => this.handleError(error, 'PANORAMALITE_RENDER_ERROR'),
    });

    player.on('ready', this.onReady);
    player.on('play', this.onPlay);
    player.on('pause', this.onPause);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    if ((options.media ?? 'video') === 'image' && options.image) {
      this.setImage(options.image).catch((error) => this.handleError(error, 'PANORAMALITE_TEXTURE_ERROR'));
    } else {
      this.bindVideo(player.getVideoElement());
    }
    this.applyEnabledState();

    emitQos(this.coreBus, 'PANORAMALITE_READY', 'info', 'PanoramaLite renderer ready');
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.applyEnabledState();
    if (enabled) {
      this.scheduleRender();
      this.scheduleVideoFrameLoop();
    } else {
      this.cancelRenderScheduling();
    }
  }

  setView(view: Partial<PanoramaLiteView>): void {
    this.view = normalizeView(view, this.limits, this.view);
    this.scheduleRender(false);
  }

  bindVideo(video: HTMLVideoElement): void {
    this.cancelRenderScheduling();
    this.detachVideoFrameEvents();
    this.restoreVideoStyle();
    this.video = video as VideoWithFrameCallback;
    this.videoFrameDirty = true;
    this.lastPresentedFrames = null;
    this.lastVideoMediaTime = null;
    this.lastVideoRenderAt = 0;
    if (this.options.crossOrigin !== undefined) {
      video.crossOrigin = this.options.crossOrigin;
    }
    this.renderer.setTextureTransform({
      textureFlipX: resolveTextureFlipX(this.options),
      textureFlipY: resolveTextureFlipY(this.options),
    });
    this.viewerControls?.bindVideo(video, 'video');
    this.renderer.setTextureSource(video);
    this.attachVideoFrameEvents(video);
    this.updateVideoVisibility();
    this.scheduleRender();
    this.scheduleVideoFrameLoop();
  }

  async setImage(image: string | HTMLImageElement | ImageBitmap): Promise<void> {
    const loaded = await loadPanoramaImage(image);
    this.cancelRenderScheduling();
    this.detachVideoFrameEvents();
    this.restoreVideoStyle();
    this.video = null;
    this.videoFrameDirty = false;
    this.renderer.setTextureTransform({
      textureFlipX: resolveTextureFlipX(this.options),
      textureFlipY: resolveTextureFlipY(this.options),
    });
    this.viewerControls?.setMedia('image');
    this.renderer.setTextureSource(loaded);
    this.scheduleRender();
  }

  setInteractive(enabled: boolean): void {
    this.interactiveEnabled = enabled;
    this.controls?.setEnabled(enabled && this.enabled);
  }

  resize(): void {
    this.renderer.requestResize();
    this.renderer.resize();
    this.scheduleRender(false);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelRenderScheduling();
    this.player.off('ready', this.onReady);
    this.player.off('play', this.onPlay);
    this.player.off('pause', this.onPause);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.detachVideoFrameEvents();
    this.controls?.destroy();
    this.controls = null;
    this.viewerControls?.destroy();
    this.viewerControls = null;
    this.renderer.destroy();
    this.restoreVideoStyle();
    this.canvas.remove();
    this.restoreHostPositioning();
  }

  private rebindCurrentVideo(): void {
    this.bindVideo(this.player.getVideoElement());
  }

  private scheduleRender(uploadTexture = true): void {
    if (this.destroyed || !this.enabled) return;
    this.pendingRenderUpload ||= uploadTexture;
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      const shouldUpload = this.pendingRenderUpload;
      this.pendingRenderUpload = false;
      this.renderOnce(shouldUpload);
    });
  }

  private scheduleVideoFrameLoop(): void {
    const video = this.video;
    if (
      this.destroyed ||
      !this.enabled ||
      !video?.requestVideoFrameCallback ||
      video.paused ||
      isDocumentHidden() ||
      this.videoFrameId !== null
    ) {
      return;
    }
    this.videoFrameId = video.requestVideoFrameCallback((now, metadata) => {
      this.videoFrameId = null;
      if (!this.destroyed && !isDocumentHidden() && this.shouldRenderVideoFrame(now, metadata)) {
        this.videoFrameDirty = true;
        this.scheduleRender();
      }
      this.scheduleVideoFrameLoop();
    });
  }

  private shouldRenderVideoFrame(now: number, metadata?: unknown): boolean {
    const frame = normalizeVideoFrameMetadata(metadata);
    if (frame.presentedFrames !== null && frame.presentedFrames === this.lastPresentedFrames) return false;
    if (frame.presentedFrames === null && frame.mediaTime !== null && frame.mediaTime === this.lastVideoMediaTime) return false;
    if (this.minVideoFrameIntervalMs <= 0 || this.lastVideoRenderAt <= 0) {
      this.lastVideoRenderAt = now;
      this.lastPresentedFrames = frame.presentedFrames;
      this.lastVideoMediaTime = frame.mediaTime;
      return true;
    }
    if (now - this.lastVideoRenderAt < this.minVideoFrameIntervalMs) return false;
    this.lastVideoRenderAt = now;
    this.lastPresentedFrames = frame.presentedFrames;
    this.lastVideoMediaTime = frame.mediaTime;
    return true;
  }

  private renderOnce(uploadTexture = true): void {
    if (!this.enabled) return;
    const shouldUpload = uploadTexture && (!this.video || !this.video.requestVideoFrameCallback || this.videoFrameDirty);
    try {
      this.renderer.render(this.view, { uploadTexture: shouldUpload });
      if (shouldUpload) this.videoFrameDirty = false;
    } catch (error) {
      this.handleError(error, 'PANORAMALITE_RENDER_ERROR');
    }
  }

  private cancelRenderScheduling(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingRenderUpload = false;
    if (this.videoFrameId !== null && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.videoFrameId);
      this.videoFrameId = null;
    }
  }

  private handleError(error: unknown, code: PanoramaLiteQosCode): void {
    emitQos(this.coreBus, code, 'warning', getErrorMessage(error));
    this.options.onError?.(error);
  }

  private applyCanvasStyle(): void {
    const style = this.canvas.style;
    style.display = 'block';
    style.position = 'absolute';
    style.inset = '0';
    style.width = '100%';
    style.height = '100%';
    style.touchAction = 'none';
    style.background = '#000';
  }

  private applyEnabledState(): void {
    this.canvas.style.display = this.enabled ? 'block' : 'none';
    this.canvas.style.pointerEvents = this.enabled ? 'auto' : 'none';
    this.controls?.setEnabled(this.enabled && this.interactiveEnabled);
    this.viewerControls?.setVisible(this.enabled);
    this.updateVideoVisibility();
  }

  private updateVideoVisibility(): void {
    const video = this.video;
    if (!video) return;
    if (!this.enabled || this.options.hideSourceVideo === false) {
      this.restoreVideoStyle();
      return;
    }
    if (!this.previousVideoVisibility) {
      this.previousVideoVisibility = {
        visibility: video.style.visibility,
        opacity: video.style.opacity,
        pointerEvents: video.style.pointerEvents,
      };
    }
    video.style.visibility = 'hidden';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
  }

  private restoreVideoStyle(): void {
    if (!this.video || !this.previousVideoVisibility) return;
    this.video.style.visibility = this.previousVideoVisibility.visibility ?? '';
    this.video.style.opacity = this.previousVideoVisibility.opacity ?? '';
    this.video.style.pointerEvents = this.previousVideoVisibility.pointerEvents ?? '';
    this.previousVideoVisibility = null;
  }

  private attachVideoFrameEvents(video: HTMLVideoElement): void {
    const events = ['loadeddata', 'loadedmetadata', 'canplay', 'playing', 'timeupdate', 'seeked'];
    for (const event of events) {
      const handler = () => {
        this.scheduleRender();
        this.scheduleVideoFrameLoop();
      };
      video.addEventListener?.(event, handler);
      this.videoEventHandlers.push({ event, handler });
    }
  }

  private detachVideoFrameEvents(): void {
    if (!this.video || !this.videoEventHandlers.length) {
      this.videoEventHandlers.length = 0;
      return;
    }
    for (const { event, handler } of this.videoEventHandlers) {
      this.video.removeEventListener?.(event, handler);
    }
    this.videoEventHandlers.length = 0;
  }

  private ensureHostPositioning(): void {
    const inlinePosition = this.host.style.position ?? '';
    const computedPosition =
      typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
        ? window.getComputedStyle(this.host).position
        : inlinePosition;
    if (computedPosition && computedPosition !== 'static') return;
    this.previousHostPosition = inlinePosition;
    this.host.style.position = 'relative';
  }

  private restoreHostPositioning(): void {
    if (this.previousHostPosition === null) return;
    this.host.style.position = this.previousHostPosition;
    this.previousHostPosition = null;
  }

  private observeResize(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      this.renderer.requestResize();
      this.scheduleRender(false);
    });
    this.resizeObserver.observe(this.host);
  }
}

function resolveTarget(target: HTMLElement | string | undefined, video: HTMLVideoElement): HTMLElement {
  if (isHTMLElement(target)) return target;
  if (typeof target === 'string') {
    const found = document.querySelector(target);
    if (!isHTMLElement(found)) {
      throw new Error(`PanoramaLite target not found: ${target}`);
    }
    return found;
  }
  if (video.parentElement) return video.parentElement;
  if (isHTMLElement(document.body)) return document.body;
  throw new Error('PanoramaLite target is required when the video element has no parent');
}

function isDocumentHidden(): boolean {
  return document.visibilityState === 'hidden';
}

function isHTMLElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
}

function resolveVideoFrameIntervalMs(maxVideoFps: number | undefined): number {
  if (typeof maxVideoFps !== 'number' || !Number.isFinite(maxVideoFps) || maxVideoFps <= 0) {
    return 0;
  }
  return 1000 / Math.min(120, Math.max(1, maxVideoFps));
}

function resolveTextureFlipX(options: PanoramaLitePluginOptions): boolean {
  if (typeof options.textureFlipX === 'boolean') return options.textureFlipX;
  return false;
}

function resolveTextureFlipY(options: PanoramaLitePluginOptions): boolean {
  if (typeof options.textureFlipY === 'boolean') return options.textureFlipY;
  return false;
}

function normalizeVideoFrameMetadata(metadata: unknown): { presentedFrames: number | null; mediaTime: number | null } {
  if (!metadata || typeof metadata !== 'object') return { presentedFrames: null, mediaTime: null };
  const candidate = metadata as { presentedFrames?: unknown; mediaTime?: unknown };
  return {
    presentedFrames: typeof candidate.presentedFrames === 'number' ? candidate.presentedFrames : null,
    mediaTime: typeof candidate.mediaTime === 'number' ? candidate.mediaTime : null,
  };
}

function emitQos(
  coreBus: EventBusLike,
  code: PanoramaLiteQosCode,
  severity: 'info' | 'warning',
  message: string
): void {
  const payload: PanoramaLiteQosPayload = {
    type: code.toLowerCase().replace(/_/g, '-'),
    code,
    severity,
    message,
    ts: Date.now(),
  };
  coreBus.emit('qos', payload);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'PanoramaLite error';
}
