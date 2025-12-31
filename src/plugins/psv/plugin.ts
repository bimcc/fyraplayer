import { FyraPsvAdapter, type FyraPsvAdapterOptions } from './FyraPsvAdapter.js';

/**
 * Factory to create a PSV plugin class without importing PSV types at build time.
 * Usage:
 *  const FyraPsvPlugin = createFyraPsvPlugin(PhotoSphereViewer);
 *  PhotoSphereViewer.registerPlugin(FyraPsvPlugin);
 */
export function createFyraPsvPlugin(PSV: any) {
  if (!PSV || !PSV.AbstractPlugin) {
    throw new Error('Photo Sphere Viewer not provided to createFyraPsvPlugin');
  }

  return class FyraPsvPlugin extends PSV.AbstractPlugin {
    static id = 'fyra-psv';
    static VERSION = '1.0.0';
    #adapter: FyraPsvAdapter | null = null;
    #opts: FyraPsvAdapterOptions;
    #videoEl: HTMLVideoElement | null = null;

    constructor(viewer: any, config: FyraPsvAdapterOptions) {
      super(viewer, config);
      this.#opts = config;
    }

    async init(): Promise<void> {
      // Prepare video element (hidden if not provided)
      if (this.#opts.video) {
        this.#videoEl = this.#opts.video;
      } else {
        this.#videoEl = document.createElement('video');
        this.#videoEl.muted = true;
        this.#videoEl.playsInline = true;
        this.#videoEl.style.position = 'absolute';
        this.#videoEl.style.width = '1px';
        this.#videoEl.style.height = '1px';
        this.#videoEl.style.opacity = '0';
        this.#videoEl.style.pointerEvents = 'none';
        document.body.appendChild(this.#videoEl);
      }

      this.#adapter = new FyraPsvAdapter({
        ...this.#opts,
        video: this.#videoEl
      });
      await this.#adapter.init();
    }

    async destroy(): Promise<void> {
      await this.#adapter?.destroy();
      this.#adapter = null;
      if (this.#videoEl && !this.#opts.video) {
        this.#videoEl.remove();
        this.#videoEl = null;
      }
      super.destroy();
    }

    getPlayer() {
      return this.#adapter?.getPlayer();
    }
  };
}

/**
 * Helper to register plugin directly.
 */
export function registerFyraPsvPlugin(PSV: any) {
  const Plugin = createFyraPsvPlugin(PSV);
  PSV.registerPlugin(Plugin);
  return Plugin;
}
