export type PanoramaLiteMediaType = 'video' | 'image';
export type PanoramaLiteProjection = 'equirectangular';

export interface PanoramaLiteView {
  yaw: number;
  pitch: number;
  roll: number;
  fov: number;
}

export interface PanoramaLiteViewLimits {
  minPitch: number;
  maxPitch: number;
  minFov: number;
  maxFov: number;
}

export interface PanoramaLitePluginOptions {
  target?: HTMLElement | string;
  media?: PanoramaLiteMediaType;
  image?: string | HTMLImageElement | ImageBitmap;
  projection?: PanoramaLiteProjection;
  enabled?: boolean;
  interactive?: boolean;
  viewerControls?: boolean | PanoramaLiteViewerControlsOptions;
  initialView?: Partial<PanoramaLiteView>;
  limits?: Partial<PanoramaLiteViewLimits>;
  pixelRatio?: number | 'auto';
  maxPixelRatio?: number;
  maxCanvasPixels?: number;
  maxVideoFps?: number;
  powerPreference?: WebGLPowerPreference;
  textureFlipX?: boolean;
  textureFlipY?: boolean;
  preserveDrawingBuffer?: boolean;
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  hideSourceVideo?: boolean;
  className?: string;
  onReady?: (handle: PanoramaLiteHandle) => void;
  onError?: (error: unknown) => void;
}

export interface PanoramaLiteViewerControlsOptions {
  enabled?: boolean;
  playback?: boolean;
  seek?: boolean;
  loop?: boolean;
  volume?: boolean;
  fullscreen?: boolean;
  resetView?: boolean;
  className?: string;
}

export interface PanoramaLiteHandle {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  setView(view: Partial<PanoramaLiteView>): void;
  getView(): PanoramaLiteView;
  resetView(): void;
  bindVideo(video: HTMLVideoElement): void;
  setImage(image: string | HTMLImageElement | ImageBitmap): Promise<void>;
  setInteractive(enabled: boolean): void;
  resize(): void;
  destroy(): void;
}

export type PanoramaLiteQosCode =
  | 'PANORAMALITE_UNSUPPORTED'
  | 'PANORAMALITE_READY'
  | 'PANORAMALITE_RENDER_ERROR'
  | 'PANORAMALITE_CONTEXT_LOST'
  | 'PANORAMALITE_CONTEXT_RESTORED'
  | 'PANORAMALITE_TEXTURE_ERROR';

export interface PanoramaLiteQosPayload {
  type: string;
  code: PanoramaLiteQosCode;
  severity: 'info' | 'warning';
  message: string;
  ts: number;
  [key: string]: unknown;
}
