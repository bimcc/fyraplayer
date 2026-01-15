/**
 * FyraPlayer UI Shell Component
 * Custom element for player UI overlay
 */

import type { PluginContext, PlayerAPI, Source } from '../types.js';
import type { UiComponentsOptions, UiElements } from './types.js';
import { UI_SHELL_STYLES, UI_SHELL_HTML } from './styles.js';
import {
  formatTime,
  getDuration,
  captureFrame,
  toggleFullscreen,
  isFullscreen,
  togglePip,
  toggleMute,
  createKeyboardHandler,
  createClickHandler,
  type KeyboardConfig,
} from './controls.js';
import { createFullscreenHandler, injectFullscreenStyles } from './fullscreen.js';
import {
  createEventCleanup,
  cleanupEvents,
  bindVideoEvents,
  bindBusEvents,
  addDomListener,
  type EventCleanup,
} from './events.js';

/**
 * FyraUiShell Custom Element
 * Provides player controls overlay with modern UI
 */
export class FyraUiShell extends HTMLElement {
  private player: PlayerAPI | null = null;
  private video: HTMLVideoElement | null = null;
  private bus: PluginContext['coreBus'] | null = null;
  private logEnabled = false;
  private duration = 0;
  private loading = true;
  private host: HTMLElement | null = null;
  private shell: HTMLElement | null = null;

  // UI Elements
  private elements: UiElements = {
    logBox: null,
    bigPlay: null,
    playBtn: null,
    timeLabel: null,
    spinner: null,
    qualitySel: null,
    cover: null,
    speedBtn: null,
  };

  // Auto-hide controls
  private hideControlsTimer: ReturnType<typeof setTimeout> | null = null;

  // Event cleanup tracking
  private keyboardHandler: ReturnType<typeof createKeyboardHandler> | null = null;
  private clickHandler: ReturnType<typeof createClickHandler> | null = null;
  private fullscreenHandler: ReturnType<typeof createFullscreenHandler> | null = null;
  private eventCleanup: EventCleanup = createEventCleanup();

  // Responsive size observer
  private resizeObserver: ResizeObserver | null = null;
  private isSmallMode = false;
  private readonly SMALL_THRESHOLD = 400;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${UI_SHELL_STYLES}</style>${UI_SHELL_HTML}`;
  }

  connectedCallback(): void {
    // Called when element is added to DOM
  }

  disconnectedCallback(): void {
    this.cleanup();
  }

  private cleanup(): void {
    this.keyboardHandler?.detach();
    this.keyboardHandler = null;

    this.clickHandler?.cleanup();
    this.clickHandler = null;

    this.fullscreenHandler?.detach();
    this.fullscreenHandler = null;

    if (this.hideControlsTimer) {
      clearTimeout(this.hideControlsTimer);
      this.hideControlsTimer = null;
    }

    // Cleanup resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    cleanupEvents(this.video, this.bus, this.eventCleanup);
  }

  attach(
    player: PlayerAPI,
    video: HTMLVideoElement,
    bus: PluginContext['coreBus'],
    opts?: UiComponentsOptions
  ): void {
    this.cleanup();

    this.player = player;
    this.video = video;
    this.bus = bus;
    this.host = this.parentElement as HTMLElement | null;

    // Force disable native controls
    if (this.video) {
      this.video.controls = false;
      this.video.removeAttribute('controls');
    }
    if (this.host) {
      const pos = getComputedStyle(this.host).position;
      if (pos === 'static') this.host.style.position = 'relative';
    }

    this.logEnabled = !!opts?.showLog;
    this.initElements();

    const state = this.player?.getState?.();
    const isAlreadyPlaying = !this.video.paused && !this.video.ended && this.video.readyState >= 2;
    const shouldSpin = state === 'loading';

    this.setBuffering(shouldSpin);
    this.applyCover(opts?.poster);
    if (this.logEnabled && this.elements.logBox) {
      this.elements.logBox.classList.add('show');
    }

    this.bindUi();
    this.bindEvents();
    this.bindKeyboard();
    this.bindClickArea();
    this.bindSpeedMenu();
    this.bindMoreMenu();
    this.bindAutoHide();
    this.bindFullscreen();
    this.bindResponsive();
    this.updateDuration();
    this.populateQuality();
    this.updatePlayUi(isAlreadyPlaying);
  }

  private initElements(): void {
    this.elements = {
      logBox: this.shadowRoot?.querySelector('.log') as HTMLElement,
      bigPlay: this.shadowRoot?.querySelector('.big-play') as HTMLElement,
      playBtn: this.shadowRoot?.querySelector('.btn-play') as HTMLElement,
      timeLabel: this.shadowRoot?.querySelector('.time') as HTMLElement,
      spinner: this.shadowRoot?.querySelector('[data-role="spinner"]') as HTMLElement,
      qualitySel: this.shadowRoot?.querySelector('.quality') as HTMLSelectElement,
      cover: this.shadowRoot?.querySelector('[data-role="cover"]') as HTMLElement,
      speedBtn: this.shadowRoot?.querySelector('[data-act="speed"]') as HTMLElement,
    };
    this.shell = this.shadowRoot?.querySelector('.shell') as HTMLElement;
  }

  private bindUi(): void {
    const progress = this.shadowRoot?.querySelector('.progress') as HTMLInputElement | null;
    const vol = this.shadowRoot?.querySelector('.vol') as HTMLInputElement | null;
    if (vol && this.video) vol.value = `${this.video.muted ? 0 : this.video.volume}`;

    this.shadowRoot?.addEventListener('click', async (e) => {
      const btn =
        (e.target as HTMLElement).closest('button') ||
        (e.target as HTMLElement).closest('.big-play');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      try {
        if (act === 'toggle-play') await this.togglePlay();
        if (act === 'fs') toggleFullscreen(this.host);
        if (act === 'pip') await togglePip(this.video);
        if (act === 'shot') captureFrame(this.video);
        if (act === 'mute') this.handleMute();
      } catch (err) {
        this.log(`[err] ${err}`);
      }
    });

    progress?.addEventListener('input', () => {
      if (!this.video || !progress) return;
      if (!this.duration || !isFinite(this.duration)) return;
      const pct = Number(progress.value) / 100;
      if (!isFinite(pct)) return;
      const clamped = Math.max(0, Math.min(1, pct));
      this.video.currentTime = clamped * this.duration;
    });

    vol?.addEventListener('input', () => {
      if (!this.video || !vol) return;
      this.video.volume = Number(vol.value);
      this.video.muted = Number(vol.value) === 0;
    });

    this.elements.qualitySel?.addEventListener('change', () => {
      if (!this.elements.qualitySel || !this.player) return;
      const idx = Number(this.elements.qualitySel.value);
      if (Number.isNaN(idx)) return;
      this.player.switchSource(idx).catch((e) => this.log(`[quality] switch failed: ${e}`));
    });
  }

  private bindEvents(): void {
    if (!this.video || !this.bus) return;

    bindVideoEvents(this.video, this.eventCleanup, {
      onTimeUpdate: () => this.updateProgress(),
      onDurationChange: () => this.updateDuration(),
      onPlay: () => this.updatePlayUi(true),
      onPause: () => this.updatePlayUi(false),
      onPlaying: () => {
        this.setBuffering(false);
        this.hideCover();
      },
      onWaiting: () => this.setBuffering(true),
      onCanPlay: () => this.setBuffering(false),
    });

    bindBusEvents(this.bus, this.eventCleanup, {
      onReady: () => {
        this.setBuffering(false);
        this.updatePlayUi(false);
        this.hideCover();
      },
      onPlay: () => {
        this.setBuffering(false);
        this.updatePlayUi(true);
        this.hideCover();
      },
      onPause: () => this.updatePlayUi(false),
      onBuffer: () => this.setBuffering(true),
      onError: (e: any) => this.log(`[error] ${JSON.stringify(e)}`),
      onNetwork: (e: any) => this.log(`[net] ${JSON.stringify(e)}`),
      onStats: (e: any) => {
        const stats = e?.stats || e;
        if (stats?.bitrateKbps || stats?.fps) {
          this.log(`[stats] ${stats.bitrateKbps || '?'}kbps ${stats.fps || '?'}fps`);
        }
      },
    });
  }

  private bindKeyboard(): void {
    const config: KeyboardConfig = {
      onTogglePlay: () => {
        if (!this.loading) this.togglePlay();
      },
      onFullscreen: () => {
        toggleFullscreen(this.host);
        this.updateFullscreenIcon();
      },
      onPip: () => togglePip(this.video),
      onToggleLog: () => this.toggleLog(),
      onSeekForward: () => {
        if (this.video) this.video.currentTime += 5;
      },
      onSeekBackward: () => {
        if (this.video) this.video.currentTime = Math.max(0, this.video.currentTime - 5);
      },
      onVolumeUp: () => {
        if (this.video) {
          this.video.volume = Math.min(1, this.video.volume + 0.1);
          this.video.muted = false;
          this.updateVolumeUi();
        }
      },
      onVolumeDown: () => {
        if (this.video) {
          this.video.volume = Math.max(0, this.video.volume - 0.1);
          this.updateVolumeUi();
        }
      },
      onMute: () => this.handleMute(),
    };

    this.keyboardHandler = createKeyboardHandler(config);
    this.keyboardHandler.attach();
  }

  private bindClickArea(): void {
    const clickArea = this.shadowRoot?.querySelector('.click-area') as HTMLElement;
    if (!clickArea) return;

    this.clickHandler = createClickHandler({
      onSingleClick: () => {
        if (!this.loading) this.togglePlay();
      },
      onDoubleClick: () => {
        toggleFullscreen(this.host);
        this.updateFullscreenIcon();
      },
      delay: 250,
    });

    clickArea.addEventListener('click', this.clickHandler.handler);
    this.eventCleanup.domCleanups.push(() => {
      if (this.clickHandler) {
        clickArea.removeEventListener('click', this.clickHandler.handler);
      }
    });
  }

  private bindSpeedMenu(): void {
    const speedMenu = this.shadowRoot?.querySelector('.speed-menu');
    if (!speedMenu) return;

    const handler = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('button[data-speed]');
      if (!btn) return;
      const speed = parseFloat(btn.getAttribute('data-speed') || '1');
      this.setPlaybackSpeed(speed);
    };

    speedMenu.addEventListener('click', handler);
    this.eventCleanup.domCleanups.push(() => {
      speedMenu.removeEventListener('click', handler);
    });
  }

  private bindMoreMenu(): void {
    const moreWrap = this.shadowRoot?.querySelector('.more-wrap');
    const moreMenu = this.shadowRoot?.querySelector('.more-menu');
    if (!moreWrap || !moreMenu) return;

    // Handle more menu button clicks
    const handler = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      
      if (act === 'speed-more') {
        // Toggle speed submenu or cycle speed
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const current = this.video?.playbackRate || 1;
        const idx = speeds.indexOf(current);
        const next = speeds[(idx + 1) % speeds.length];
        this.setPlaybackSpeed(next);
      }
      // shot and pip are handled by main bindUi
    };

    moreMenu.addEventListener('click', handler);
    this.eventCleanup.domCleanups.push(() => {
      moreMenu.removeEventListener('click', handler);
    });
  }

  private bindResponsive(): void {
    if (!this.host) return;

    const updateSize = () => {
      if (!this.host) return;
      const width = this.host.offsetWidth;
      const wasSmall = this.isSmallMode;
      this.isSmallMode = width < this.SMALL_THRESHOLD;

      if (wasSmall !== this.isSmallMode) {
        this.updateResponsiveUI();
      }
    };

    // Use ResizeObserver for efficient size detection
    this.resizeObserver = new ResizeObserver(updateSize);
    this.resizeObserver.observe(this.host);

    // Initial check
    updateSize();
  }

  private updateResponsiveUI(): void {
    const collapsibles = this.shadowRoot?.querySelectorAll('.collapsible');
    const moreWrap = this.shadowRoot?.querySelector('.more-wrap') as HTMLElement;

    if (this.isSmallMode) {
      // Small mode: hide collapsible buttons, show more menu
      collapsibles?.forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
      if (moreWrap) moreWrap.style.display = 'flex';
    } else {
      // Normal mode: show collapsible buttons, hide more menu
      collapsibles?.forEach((el) => {
        (el as HTMLElement).style.display = '';
      });
      if (moreWrap) moreWrap.style.display = 'none';
    }
  }

  private bindAutoHide(): void {
    if (!this.shell) return;

    const showControls = () => {
      this.shell?.classList.remove('hide-controls');
      this.resetHideTimer();
    };

    const hideControls = () => {
      if (this.video && !this.video.paused) {
        this.shell?.classList.add('hide-controls');
      }
    };

    this.resetHideTimer = () => {
      if (this.hideControlsTimer) {
        clearTimeout(this.hideControlsTimer);
      }
      this.hideControlsTimer = setTimeout(hideControls, 3000);
    };

    addDomListener(this.shell, 'mousemove', showControls, this.eventCleanup);
    addDomListener(this.shell, 'mouseenter', showControls, this.eventCleanup);
    addDomListener(
      this.shell,
      'mouseleave',
      () => {
        if (this.video && !this.video.paused) hideControls();
      },
      this.eventCleanup
    );

    this.resetHideTimer();
  }

  private bindFullscreen(): void {
    this.fullscreenHandler = createFullscreenHandler(
      this.video,
      this.host,
      this,
      () => this.updateFullscreenIcon()
    );
    this.fullscreenHandler.attach();
  }

  private resetHideTimer: () => void = () => {};

  private async togglePlay(): Promise<void> {
    if (!this.player || !this.video) return;
    try {
      if (this.video.paused) {
        await this.player.play();
        try {
          await this.video.play();
        } catch {
          /* ignore */
        }
        this.updatePlayUi(true);
      } else {
        await this.player.pause();
        this.video.pause();
        this.updatePlayUi(false);
      }
    } catch (err) {
      this.updatePlayUi(false);
      this.log(`[play] failed: ${err}`);
    }
  }

  private handleMute(): void {
    toggleMute(this.video);
    this.updateVolumeUi();
  }

  private setPlaybackSpeed(speed: number): void {
    if (!this.video) return;
    this.video.playbackRate = speed;

    if (this.elements.speedBtn) {
      this.elements.speedBtn.textContent = `${speed}x`;
    }

    const speedMenu = this.shadowRoot?.querySelector('.speed-menu');
    speedMenu?.querySelectorAll('button').forEach((btn) => {
      const btnSpeed = parseFloat(btn.getAttribute('data-speed') || '1');
      btn.classList.toggle('active', btnSpeed === speed);
    });
  }

  private updateVolumeUi(): void {
    const vol = this.shadowRoot?.querySelector('.vol') as HTMLInputElement | null;
    const volIcon = this.shadowRoot?.querySelector('.vol-icon') as SVGElement | null;

    if (vol && this.video) {
      vol.value = this.video.muted ? '0' : `${this.video.volume}`;
    }

    if (volIcon && this.video) {
      if (this.video.muted || this.video.volume === 0) {
        volIcon.innerHTML =
          '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>';
      } else if (this.video.volume < 0.5) {
        volIcon.innerHTML =
          '<path d="M7 9v6h4l5 5V4l-5 5H7z"/><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>';
      } else {
        volIcon.innerHTML =
          '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>';
      }
    }
  }

  private updateFullscreenIcon(): void {
    const fsIcon = this.shadowRoot?.querySelector('.fs-icon') as SVGElement | null;
    if (!fsIcon) return;

    if (isFullscreen()) {
      fsIcon.innerHTML =
        '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>';
    } else {
      fsIcon.innerHTML =
        '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>';
    }
  }

  private updatePlayUi(playing: boolean): void {
    if (this.elements.bigPlay) {
      this.elements.bigPlay.style.display = playing ? 'none' : 'flex';
    }
    if (this.elements.playBtn) {
      const svg = this.elements.playBtn.querySelector('svg');
      if (svg) {
        svg.innerHTML = playing
          ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>'
          : '<path d="M8 5v14l11-7z"/>';
      }
    }
  }

  private updateProgress(): void {
    if (!this.video) return;
    const progress = this.shadowRoot?.querySelector('.progress') as HTMLInputElement | null;
    const dur = getDuration(this.video);
    this.duration = dur;
    const cur = this.video.currentTime || 0;

    if (!isFinite(dur) || dur <= 0) {
      if (progress) {
        progress.value = '0';
        progress.disabled = true;
      }
      if (this.elements.timeLabel) {
        this.elements.timeLabel.textContent = `${formatTime(cur)} / LIVE`;
      }
      this.updatePlayUi(!this.video.paused && !this.video.ended);
      return;
    }

    const pct = (cur / dur) * 100;
    if (progress) {
      progress.disabled = false;
      progress.value = `${Math.max(0, Math.min(100, pct))}`;
    }
    if (this.elements.timeLabel) {
      this.elements.timeLabel.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
    }
    this.updatePlayUi(!this.video.paused && !this.video.ended);
  }

  private updateDuration(): void {
    if (!this.video) return;
    const dur = getDuration(this.video);
    this.duration = dur;
    if (this.elements.timeLabel) {
      this.elements.timeLabel.textContent =
        isFinite(dur) && dur > 0 ? `00:00 / ${formatTime(dur)}` : '00:00 / LIVE';
    }
  }

  private toggleLog(): void {
    this.logEnabled = !this.logEnabled;
    if (this.elements.logBox) {
      this.elements.logBox.classList.toggle('show', this.logEnabled);
    }
  }

  private setBuffering(on: boolean): void {
    this.loading = on;
    if (this.elements.spinner) {
      this.elements.spinner.style.display = on ? 'block' : 'none';
    }
    if (this.elements.bigPlay) {
      this.elements.bigPlay.style.display = on
        ? 'none'
        : this.video && this.video.paused
          ? 'flex'
          : 'none';
    }
  }

  private populateQuality(): void {
    if (!this.elements.qualitySel) return;
    const sources = ((this.player as any)?.options?.sources as Source[] | undefined) ?? [];
    if (!sources.length || sources.length === 1) {
      this.elements.qualitySel.style.display = 'none';
      return;
    }
    this.elements.qualitySel.style.display = 'block';
    this.elements.qualitySel.innerHTML = '';
    const current = sources.indexOf(this.player?.getCurrentSource?.() as any);
    sources.forEach((s, idx) => {
      const opt = document.createElement('option');
      const label = (s as any).label || (s as any).name || `${s.type} ${idx + 1}`;
      opt.value = String(idx);
      opt.textContent = label;
      this.elements.qualitySel?.appendChild(opt);
    });
    if (current >= 0) this.elements.qualitySel.value = String(current);
  }

  private applyCover(poster?: string): void {
    const url = poster || this.video?.poster;
    if (!url || !this.elements.cover) {
      this.hideCover();
      return;
    }
    this.elements.cover.style.display = 'block';
    this.elements.cover.style.backgroundImage = `url('${url}')`;
    if (this.video && poster) this.video.poster = poster;
  }

  private hideCover(): void {
    if (this.elements.cover) this.elements.cover.style.display = 'none';
  }

  private log(msg: string): void {
    if (!this.logEnabled || !this.elements.logBox) return;
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
    this.elements.logBox.appendChild(line);
    this.elements.logBox.scrollTop = this.elements.logBox.scrollHeight;
  }
}

// Register custom element
if (!customElements.get('fyra-ui-shell')) {
  customElements.define('fyra-ui-shell', FyraUiShell);
}

/**
 * Create UI Components Plugin
 */
export function createUiComponentsPlugin(opts?: UiComponentsOptions) {
  return (ctx: PluginContext) => {
    const target =
      typeof opts?.target === 'string'
        ? (document.querySelector(opts.target) as HTMLElement | null)
        : (opts?.target as HTMLElement | null);
    const video =
      (target?.querySelector('video') as HTMLVideoElement | null) ||
      (document.querySelector('video') as HTMLVideoElement | null);
    if (!video) return;
    const host = target || video.parentElement || document.body;

    // Disable native controls
    video.controls = false;
    video.removeAttribute('controls');

    // Inject fullscreen styles
    injectFullscreenStyles();
    host.classList.add('fyra-player-container');

    // Clean up existing shell
    const existing = host.querySelector('fyra-ui-shell');
    existing?.remove();

    const shell = document.createElement('fyra-ui-shell') as FyraUiShell & {
      attach?: (
        p: PlayerAPI,
        v: HTMLVideoElement,
        bus: PluginContext['coreBus'],
        o?: UiComponentsOptions
      ) => void;
    };
    shell.style.position = 'absolute';
    shell.style.inset = '0';
    shell.style.pointerEvents = 'none';
    host.style.position = host.style.position || 'relative';
    host.appendChild(shell);
    shell.attach?.(ctx.player, video, ctx.coreBus, opts);

    if (ctx.ui?.registerComponent) {
      ctx.ui.registerComponent('fyra-ui-shell', shell);
    }
  };
}
