/**
 * CanvasFrameBuffer
 *
 * Minimal renderer that blits VideoFrame/HTMLVideoElement onto a canvas,
 * then exposes the canvas (and optional captureStream) for consumers like
 * PSV or custom WebGL sphere mappers to use as a texture source.
 *
 * Note: This does NOT perform sphere mapping itself; it only provides a
 * canvas-backed texture source with basic sizing and captureStream support.
 */
export class CanvasFrameBuffer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private disposed = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Render a VideoFrame onto the canvas.
   */
  renderFrame(frame: VideoFrame): void {
    if (this.disposed || !this.ctx) return;
    const w = Math.max(1, frame.displayWidth || frame.codedWidth || 1);
    const h = Math.max(1, frame.displayHeight || frame.codedHeight || 1);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    // @ts-ignore VideoFrame is allowed in drawImage in modern browsers
    this.ctx.drawImage(frame as any, 0, 0, w, h);
  }

  /**
   * Render a video element onto the canvas.
   */
  renderVideo(video: HTMLVideoElement): void {
    if (this.disposed || !this.ctx) return;
    const w = Math.max(1, video.videoWidth || 1);
    const h = Math.max(1, video.videoHeight || 1);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(video, 0, 0, w, h);
  }

  /**
   * Get the backing canvas for use as a texture source.
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Capture the canvas as a MediaStream (e.g., to feed a hidden video element).
   */
  getCaptureStream(frameRate = 30): MediaStream | null {
    if (this.stream) return this.stream;
    // @ts-ignore captureStream exists on canvas in modern browsers
    this.stream = this.canvas.captureStream ? this.canvas.captureStream(frameRate) : null;
    return this.stream;
  }

  destroy(): void {
    if (this.disposed) return;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx = null;
    this.disposed = true;
  }
}
