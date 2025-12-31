/**
 * Abstract base class for video rendering targets.
 * A Target is responsible for "accepting" the video content from FyraPlayer
 * and displaying it (e.g., on a DOM element, a Canvas, or a WebGL texture).
 */
export abstract class BaseTarget {
  /**
   * Called when the player is ready to attach a video element.
   * @param video The HTMLVideoElement containing the media stream.
   */
  abstract attach(video: HTMLVideoElement): void;

  /**
   * Called to detach/cleanup the video element.
   */
  abstract detach(): void;

  /**
   * Called on every animation frame (optional) if the target needs manual updating.
   * @param time Current video time in seconds
   */
  abstract render(time: number): void;

  /**
   * Cleanup resources.
   */
  abstract destroy(): void;
}
