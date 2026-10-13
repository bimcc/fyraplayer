/**
 * FyraPlayer UI Shell Component
 * Custom element for player UI overlay
 */

import type { PluginContext, PlayerAPI, QualityLevel, Source } from '../types.js';
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
  addBusListener,
  type EventCleanup,
} from './events.js';

/**
 * FyraUiShell Custom Element
 * Provides player controls overlay with modern UI
 */
// Keep public package imports safe for SSR/build tools. UI creation still needs a DOM.
const HTMLElementBase = globalThis.HTMLElement ?? class {
  constructor() { throw new Error('FyraUiShell requires a browser DOM'); }
} as typeof HTMLElement;

export class FyraUiShell extends HTMLElementBase {
  private player: PlayerAPI | null = null;
  private video: HTMLVideoElement | null = null;
  private bus: PluginContext['coreBus'] | null = null;
  private logEnabled = false;
  private duration = 0;
  private loading = true;
  private stopped = false;
  private showStatusOverlay = true;
  private onRetry: (() => void | Promise<void>) | undefined;
  private showDiagnosticsButton = false;
  private showRecordingButton = false;
  private recording = false;
  private uiOptions: UiComponentsOptions | undefined;
  private host: HTMLElement | null = null;
  private shell: HTMLElement | null = null;

  // UI Elements
  private elements: UiElements = {
    logBox: null,
    bigPlay: null,
    playBtn: null,
    timeLabel: null,
    spinner: null,
    statusCard: null,
    statusMessage: null,
    statusDetail: null,
    retryBtn: null,
    cancelBtn: null,
    stopBtn: null,
    diagnosticsBtn: null,
    diagnosticsMenuBtn: null,
    recordBtn: null,
    recordMenuBtn: null,
    qualitySel: null,
    cover: null,
    speedBtn: null,
  };

  // Auto-hide controls
  private hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
  private suppressClickUntil = 0;

  // Event cleanup tracking
  private keyboardHandler: ReturnType<typeof createKeyboardHandler> | null = null;
  private clickHandler: ReturnType<typeof createClickHandler> | null = null;
  private fullscreenHandler: ReturnType<typeof createFullscreenHandler> | null = null;
  private eventCleanup: EventCleanup = createEventCleanup();

  // Responsive size observer
  private resizeObserver: ResizeObserver | null = null;
  private isSmallMode = false;
  private readonly SMALL_THRESHOLD = 520;

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }

  private getPlayerSources(): Source[] {
    if (this.player?.getSources) return this.player.getSources();
    type PlayerWithOptions = PlayerAPI & {
      options?: {
        sources?: Source[];
      };
    };
    const playerWithOptions = this.player as PlayerWithOptions | null;
    return playerWithOptions?.options?.sources ?? [];
  }

  private getSourceLabel(source: Source, index: number): string {
    const sourceWithName = source as Source & { label?: string; name?: string };
    return sourceWithName.label || sourceWithName.name || `${source.type} ${index + 1}`;
  }

  private getQualityLabel(level: QualityLevel): string {
    if (level.label) return level.label;
    const parts: string[] = [];
    if (level.height) parts.push(`${level.height}p`);
    if (level.bitrateKbps) parts.push(`${level.bitrateKbps} kbps`);
    return parts.join(' ') || `Level ${level.index ?? level.id}`;
  }

  private emitPreference(key: string, value: unknown): void {
    this.bus?.emit('preference', {
      key,
      value,
      source: 'ui',
      ts: Date.now(),
    });
  }

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
    this.showStatusOverlay = opts?.showStatusOverlay !== false;
    this.onRetry = opts?.onRetry;
    this.uiOptions = opts;
    this.showDiagnosticsButton = opts?.showDiagnosticsButton ?? !!opts?.onDiagnostics;
    this.showRecordingButton = opts?.showRecordingButton ?? false;
    this.recording = false;
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
    this.updateLoopUi();
    this.updatePlayUi(isAlreadyPlaying);
  }

  private initElements(): void {
    this.elements = {
      logBox: this.shadowRoot?.querySelector('.log') as HTMLElement,
      bigPlay: this.shadowRoot?.querySelector('.big-play') as HTMLElement,
      playBtn: this.shadowRoot?.querySelector('.btn-play') as HTMLElement,
      timeLabel: this.shadowRoot?.querySelector('.time') as HTMLElement,
      spinner: this.shadowRoot?.querySelector('[data-role="spinner"]') as HTMLElement,
      statusCard: this.shadowRoot?.querySelector('[data-role="status-card"]') as HTMLElement,
      statusMessage: this.shadowRoot?.querySelector('[data-role="status-message"]') as HTMLElement,
      statusDetail: this.shadowRoot?.querySelector('[data-role="status-detail"]') as HTMLElement,
      retryBtn: this.shadowRoot?.querySelector('[data-role="retry"]') as HTMLElement,
      cancelBtn: this.shadowRoot?.querySelector('[data-role="cancel"]') as HTMLElement,
      stopBtn: this.shadowRoot?.querySelector('.bar [data-act="stop"]') as HTMLElement,
      diagnosticsBtn: this.shadowRoot?.querySelector('.bar [data-act="diagnostics"]') as HTMLElement,
      diagnosticsMenuBtn: this.shadowRoot?.querySelector('.more-menu [data-act="diagnostics"]') as HTMLElement,
      recordBtn: this.shadowRoot?.querySelector('.bar [data-act="record"]') as HTMLElement,
      recordMenuBtn: this.shadowRoot?.querySelector('.more-menu [data-act="record"]') as HTMLElement,
      qualitySel: this.shadowRoot?.querySelector('.quality') as HTMLSelectElement,
      cover: this.shadowRoot?.querySelector('[data-role="cover"]') as HTMLElement,
      speedBtn: this.shadowRoot?.querySelector('[data-act="speed"]') as HTMLElement,
    };
    this.shell = this.shadowRoot?.querySelector('.shell') as HTMLElement;
    if (this.elements.stopBtn) this.elements.stopBtn.style.display = this.player?.stop ? '' : 'none';
    const menuStop = this.shadowRoot?.querySelector('.more-menu [data-act="stop"]') as HTMLElement | null;
    if (menuStop) menuStop.style.display = this.player?.stop ? '' : 'none';
    const pipAvailable = document.pictureInPictureEnabled && typeof this.video?.requestPictureInPicture === 'function';
    this.shadowRoot?.querySelectorAll('[data-act="pip"]').forEach(button => {
      (button as HTMLElement).style.display = pipAvailable ? '' : 'none';
      button.classList.toggle('pip-unavailable', !pipAvailable);
    });
    if (this.elements.diagnosticsBtn) {
      this.elements.diagnosticsBtn.style.display = this.showDiagnosticsButton ? '' : 'none';
    }
    if (this.elements.diagnosticsMenuBtn) {
      this.elements.diagnosticsMenuBtn.style.display = this.showDiagnosticsButton ? '' : 'none';
    }
    if (this.elements.recordBtn) {
      this.elements.recordBtn.style.display = this.showRecordingButton ? '' : 'none';
    }
    if (this.elements.recordMenuBtn) {
      this.elements.recordMenuBtn.style.display = this.showRecordingButton ? '' : 'none';
    }
    this.updateRecordingUi();
  }

  private updateOptionalControlVisibility(): void {
    const showCollapsible = this.isSmallMode ? 'none' : '';
    if (this.elements.qualitySel) {
      this.elements.qualitySel.style.display = this.elements.qualitySel.dataset.mode ? showCollapsible : 'none';
    }
    this.updateLoopUi();
    if (this.elements.stopBtn) this.elements.stopBtn.style.display = this.player?.stop ? showCollapsible : 'none';
    if (this.elements.diagnosticsBtn) {
      this.elements.diagnosticsBtn.style.display = this.showDiagnosticsButton ? showCollapsible : 'none';
    }
    if (this.elements.diagnosticsMenuBtn) {
      this.elements.diagnosticsMenuBtn.style.display = this.showDiagnosticsButton ? '' : 'none';
    }
    if (this.elements.recordBtn) {
      this.elements.recordBtn.style.display = this.showRecordingButton ? showCollapsible : 'none';
    }
    if (this.elements.recordMenuBtn) {
      this.elements.recordMenuBtn.style.display = this.showRecordingButton ? '' : 'none';
    }
  }

  private bindUi(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const progress = this.shadowRoot?.querySelector('.progress') as HTMLInputElement | null;
    const vol = this.shadowRoot?.querySelector('.vol') as HTMLInputElement | null;
    if (vol && this.video) vol.value = `${this.video.muted ? 0 : this.video.volume}`;

    addDomListener(root, 'click', async (e) => {
      const btn =
        (e.target as HTMLElement).closest('button') ||
        (e.target as HTMLElement).closest('.big-play');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      try {
        if (act === 'toggle-play') await this.togglePlay();
        if (act === 'fs') await toggleFullscreen(this.host);
        if (act === 'pip') await togglePip(this.video);
        if (act === 'shot') await this.captureScreenshot();
        if (act === 'mute') this.handleMute();
        if (act === 'loop' && this.video && Number.isFinite(this.video.duration) && this.video.duration > 0) {
          this.video.loop = !this.video.loop;
          this.updateLoopUi();
          this.emitPreference('loop', this.video.loop);
        }
        if (act === 'more' || act === 'speed') {
          const wrap = btn.parentElement;
          if (wrap) {
            const open = !wrap.classList.contains('open');
            this.closeMenus();
            wrap.classList.toggle('open', open);
            btn.setAttribute('aria-expanded', String(open));
            this.showControls();
          }
        }
        if (act === 'retry') await this.retryPlayback();
        if (act === 'stop') await this.player?.stop?.();
        if (act === 'diagnostics') await this.openDiagnostics();
        if (act === 'record') await this.toggleRecording();
      } catch (err) {
        this.log(`[err] ${err}`);
      }
    }, this.eventCleanup);

    if (progress) addDomListener(progress, 'input', () => {
      if (!this.video || !progress) return;
      if (!this.duration || !isFinite(this.duration)) return;
      const pct = Number(progress.value) / 100;
      if (!isFinite(pct)) return;
      const clamped = Math.max(0, Math.min(1, pct));
      this.video.currentTime = clamped * this.duration;
    }, this.eventCleanup);

    if (vol) addDomListener(vol, 'input', () => {
      if (!this.video || !vol) return;
      this.video.volume = Number(vol.value);
      this.video.muted = Number(vol.value) === 0;
      this.emitPreference('volume', this.video.volume);
      this.emitPreference('muted', this.video.muted);
    }, this.eventCleanup);

    const menuQuality = this.shadowRoot?.querySelector('.quality-more') as HTMLSelectElement | null;
    if (menuQuality) addDomListener(menuQuality, 'change', () => {
      if (!this.elements.qualitySel) return;
      this.elements.qualitySel.value = menuQuality.value;
      this.elements.qualitySel.dispatchEvent(new Event('change'));
      this.closeMenus();
    }, this.eventCleanup);

    if (this.elements.qualitySel) addDomListener(this.elements.qualitySel, 'change', () => {
      if (!this.elements.qualitySel || !this.player) return;
      const value = this.elements.qualitySel.value;
      const mode = this.elements.qualitySel.dataset.mode;
      if (mode === 'quality') {
        const numericValue = Number(value);
        const level = value === 'auto'
          ? 'auto'
          : Number.isNaN(numericValue)
            ? value
            : numericValue;
        this.emitPreference('quality', level);
        this.player.setQualityLevel(level).catch((e) => this.log(`[quality] switch failed: ${e}`));
        this.syncQualityMenu();
        return;
      }
      const idx = Number(value);
      if (!Number.isNaN(idx)) {
        this.emitPreference('sourceIndex', idx);
        this.player.switchSource(idx).catch((e) => this.log(`[source] switch failed: ${e}`));
      }
      this.syncQualityMenu();
    }, this.eventCleanup);
  }

  private bindEvents(): void {
    if (!this.video || !this.bus) return;
    const loopObserver = new MutationObserver(() => this.updateLoopUi());
    loopObserver.observe(this.video, { attributes: true, attributeFilter: ['loop'] });
    this.eventCleanup.domCleanups.push(() => loopObserver.disconnect());

    bindVideoEvents(this.video, this.eventCleanup, {
      onTimeUpdate: () => { if (!this.stopped) this.updateProgress(); },
      onDurationChange: () => { if (!this.stopped) this.updateDuration(); },
      onPlay: () => { if (!this.stopped) this.updatePlayUi(true); },
      onPause: () => this.updatePlayUi(false),
      onPlaying: () => {
        if (this.stopped) return;
        this.setBuffering(false);
        this.setStatusMessage('');
        this.hideCover();
      },
      onWaiting: () => { if (!this.stopped) this.setBuffering(true); },
      onCanPlay: () => {
        if (this.stopped) return;
        this.setBuffering(false);
        this.setStatusMessage('');
      },
    });

    bindBusEvents(this.bus, this.eventCleanup, {
      onReady: () => {
        this.setBuffering(false);
        this.setStatusMessage('');
        this.updatePlayUi(false);
        this.hideCover();
        this.populateQuality();
      },
      onPlay: () => {
        this.setBuffering(false);
        this.setStatusMessage('');
        this.updatePlayUi(true);
        this.hideCover();
      },
      onPause: () => this.updatePlayUi(false),
      onStop: () => {
        this.stopped = true;
        this.updateLoopUi();
        this.shell?.classList.remove('hide-controls');
        this.setBuffering(false);
        this.setStatusMessage('');
        this.updatePlayUi(false);
        if (this.elements.timeLabel) this.elements.timeLabel.textContent = '00:00 / --:--';
        const progress = this.shadowRoot?.querySelector('.progress') as HTMLInputElement | null;
        if (progress) progress.value = '0';
      },
      onBuffer: () => this.setBuffering(true),
      onLevelSwitch: () => this.populateQuality(),
      onError: (eventPayload: unknown) => {
        this.setBuffering(false);
        this.updatePlayUi(false);
        this.log(`[error] ${JSON.stringify(eventPayload)}`);
      },
      onNetwork: (eventPayload: unknown) => {
        const payloadRecord = this.asRecord(eventPayload);
        const severity = typeof payloadRecord?.severity === 'string' ? payloadRecord.severity : undefined;
        const type = typeof payloadRecord?.type === 'string' ? payloadRecord.type : undefined;
        const code = typeof payloadRecord?.code === 'string' ? payloadRecord.code : undefined;
        const attempt = typeof payloadRecord?.attempt === 'number' ? payloadRecord.attempt : undefined;
        const maxRetries = typeof payloadRecord?.maxRetries === 'number' ? payloadRecord.maxRetries : undefined;
        const details = code ? `${code}${attempt !== undefined ? ` ${attempt}/${maxRetries ?? '-'}` : ''}` : undefined;
        if (type === 'autoplay-blocked' || code === 'AUTOPLAY_BLOCKED') {
          this.setBuffering(false);
          this.setStatusMessage('浏览器阻止自动播放，请轻触播放按钮', details, true);
          this.updatePlayUi(false);
        } else if (type === 'reconnect' || code === 'RECONNECT_ATTEMPT') {
          this.setBuffering(true);
          this.setStatusMessage('视频流中断，正在重新连接...', details, false);
        } else if (type === 'reconnect-exhausted' || code === 'RECONNECT_EXHAUSTED') {
          this.setBuffering(false);
          this.setStatusMessage('视频流中断，请重试', details, true);
          this.updatePlayUi(false);
        } else if (severity === 'fatal') {
          this.setStatusMessage('视频流中断，正在尝试恢复...', details, false);
        }
        if (severity === 'fatal' || type === 'reconnect-exhausted') {
          this.setBuffering(false);
          this.updatePlayUi(false);
        }
        this.log(`[net] ${JSON.stringify(eventPayload)}`);
      },
      onStats: (eventPayload: unknown) => {
        const payloadRecord = this.asRecord(eventPayload);
        const rawStats = payloadRecord?.stats ?? eventPayload;
        const statsRecord = this.asRecord(rawStats);
        const bitrateKbps =
          typeof statsRecord?.bitrateKbps === 'number' ? statsRecord.bitrateKbps : undefined;
        const fps = typeof statsRecord?.fps === 'number' ? statsRecord.fps : undefined;
        if (bitrateKbps !== undefined || fps !== undefined) {
          this.log(`[stats] ${bitrateKbps ?? '?'}kbps ${fps ?? '?'}fps`);
        }
      },
    });
    addBusListener(this.bus, 'sessionchange', event => {
      const reason = this.asRecord(event)?.reason;
      if (reason === 'load' || reason === 'switch' || reason === 'reconnect') {
        this.stopped = false;
        if (this.elements.qualitySel) {
          this.elements.qualitySel.innerHTML = '';
          this.elements.qualitySel.dataset.mode = '';
          this.syncQualityMenu();
        }
        this.setBuffering(true);
      }
    }, this.eventCleanup);
  }

  private bindKeyboard(): void {
    if (!this.host) return;
    const host = this.host;
    const originalTabIndex = host.getAttribute('tabindex');
    if (originalTabIndex === null) host.tabIndex = 0;
    this.eventCleanup.domCleanups.push(() => {
      if (originalTabIndex === null && host.getAttribute('tabindex') === '0') host.removeAttribute('tabindex');
    });
    const config: KeyboardConfig = {
      target: host,
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

    let touchStart: { x: number; y: number; id: number } | null = null;
    addDomListener(clickArea, 'pointerdown', event => {
      this.host?.focus({ preventScroll: true });
      const pointer = event as PointerEvent;
      if (pointer.pointerType !== 'touch') return;
      touchStart = { x: pointer.clientX, y: pointer.clientY, id: pointer.pointerId };
      this.suppressClickUntil = Date.now() + 700;
    }, this.eventCleanup);
    addDomListener(clickArea, 'pointercancel', () => { touchStart = null; }, this.eventCleanup);
    addDomListener(clickArea, 'pointerup', event => {
      const pointer = event as PointerEvent;
      if (!touchStart || touchStart.id !== pointer.pointerId) return;
      const moved = Math.hypot(pointer.clientX - touchStart.x, pointer.clientY - touchStart.y);
      touchStart = null;
      this.suppressClickUntil = Date.now() + 700;
      if (moved > 12) return;
      this.closeMenus();
      if (this.video?.paused) { this.showControls(); if (!this.loading) void this.togglePlay(); }
      else if (this.shell?.classList.contains('hide-controls')) this.showControls();
      else this.hideControls();
    }, this.eventCleanup);
    addDomListener(clickArea, 'click', event => {
      if (Date.now() < this.suppressClickUntil) return;
      this.clickHandler?.handler(event as MouseEvent);
    }, this.eventCleanup);
    addDomListener(this.shell!, 'click', event => {
      if (!(event.target as HTMLElement).closest('.more-wrap,.speed-wrap,.vol-wrap')) this.closeMenus();
    }, this.eventCleanup);
  }

  private bindSpeedMenu(): void {
    const speedMenu = this.shadowRoot?.querySelector('.speed-menu');
    if (!speedMenu) return;

    const handler = (e: Event) => {
      const btn = (e.target as HTMLElement).closest('button[data-speed]');
      if (!btn) return;
      const speed = parseFloat(btn.getAttribute('data-speed') || '1');
      this.setPlaybackSpeed(speed);
      this.closeMenus();
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
      this.closeMenus();
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
      this.style.setProperty('--fyra-menu-height', `${Math.max(44, this.host.clientHeight - 66)}px`);
      const wasSmall = this.isSmallMode;
      this.isSmallMode = width < this.SMALL_THRESHOLD;
      this.classList.toggle('fyra-small', this.isSmallMode);

      if (wasSmall !== this.isSmallMode) this.closeMenus();
      this.updateResponsiveUI();
    };

    // Use ResizeObserver for efficient size detection
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(updateSize);
      this.resizeObserver.observe(this.host);
    } else addDomListener(window, 'resize', updateSize, this.eventCleanup);

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

    this.updateOptionalControlVisibility();
  }

  private bindAutoHide(): void {
    if (!this.shell) return;
    this.resetHideTimer = () => {
      if (this.hideControlsTimer) clearTimeout(this.hideControlsTimer);
      this.hideControlsTimer = setTimeout(() => this.hideControls(), 3000);
    };
    addDomListener(this.shell, 'pointermove', event => {
      if ((event as PointerEvent).pointerType === 'mouse') this.showControls();
    }, this.eventCleanup);
    addDomListener(this.shell, 'pointerdown', event => {
      if ((event.target as HTMLElement).closest('.bottom')) this.showControls();
    }, this.eventCleanup);
    addDomListener(this.shell, 'focusin', () => this.showControls(), this.eventCleanup);
    addDomListener(this.shell, 'focusout', () => this.resetHideTimer(), this.eventCleanup);
    if (this.video) {
      addDomListener(this.video, 'play', () => this.showControls(), this.eventCleanup);
      addDomListener(this.video, 'pause', () => this.showControls(), this.eventCleanup);
    }
    this.resetHideTimer();
  }

  private closeMenus(): void {
    this.shadowRoot?.querySelectorAll('.more-wrap.open,.speed-wrap.open').forEach(wrap => {
      wrap.classList.remove('open');
      wrap.querySelector('button')?.setAttribute('aria-expanded', 'false');
    });
  }

  private showControls(): void {
    this.shell?.classList.remove('hide-controls');
    this.resetHideTimer();
  }

  private hideControls(): void {
    if (!this.video || this.video.paused || this.loading || this.shadowRoot?.querySelector('.open')) return;
    if (this.shadowRoot?.activeElement?.matches(':focus-visible')) return;
    this.shell?.classList.add('hide-controls');
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
    if (this.loading && this.player.stop) {
      await this.player.stop();
      return;
    }
    try {
      if (this.video.paused) {
        await this.player.play();
        if (!this.stopped) this.updatePlayUi(!this.video.paused);
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
    if (this.video) {
      this.emitPreference('muted', this.video.muted);
      this.emitPreference('volume', this.video.volume);
    }
  }

  private async retryPlayback(): Promise<void> {
    try {
      if (this.onRetry) {
        await this.onRetry();
      } else {
        await this.player?.play();
      }
      this.setStatusMessage('');
    } catch (err) {
      this.log(`[retry] failed: ${err}`);
    }
  }

  private getActionContext() {
    if (!this.player || !this.video) return null;
    return {
      player: this.player,
      video: this.video,
    };
  }

  private async openDiagnostics(): Promise<void> {
    const context = this.getActionContext();
    if (!context) return;
    await this.uiOptions?.onDiagnostics?.(context);
    this.log('[ui] diagnostics opened');
  }

  private async captureScreenshot(): Promise<void> {
    let result = null;
    try {
      result = await captureFrame(this.video);
    } catch (err) {
      this.setStatusMessage('截图失败', 'SCREENSHOT_BLOCKED', false, true);
      this.log(`[screenshot] capture failed: ${err}`);
      return;
    }
    if (!result || !this.player || !this.video) {
      this.setStatusMessage('截图失败', 'SCREENSHOT_UNAVAILABLE', false, true);
      return;
    }
    this.setStatusMessage('截图已保存', `${result.width}x${result.height}`, false, true);
    try {
      await this.uiOptions?.onScreenshot?.({
        ...result,
        player: this.player,
        video: this.video,
      });
    } catch (err) {
      this.log(`[screenshot] hook failed: ${err}`);
    }
  }

  private async toggleRecording(): Promise<void> {
    const context = this.getActionContext();
    if (!context) return;
    const nextRecording = !this.recording;
    try {
      await this.uiOptions?.onRecordToggle?.({
        ...context,
        recording: nextRecording,
        ts: Date.now(),
      });
    } catch (err) {
      this.setStatusMessage('录制失败', 'RECORD_HOOK_FAILED', false, true);
      this.log(`[record] hook failed: ${err}`);
      return;
    }
    this.recording = nextRecording;
    this.updateRecordingUi();
    this.setStatusMessage(this.recording ? '录制已开始' : '录制已停止', '', false, true);
  }

  private updateRecordingUi(): void {
    this.elements.recordBtn?.classList.toggle('active', this.recording);
    this.elements.recordMenuBtn?.classList.toggle('active', this.recording);
  }

  private setPlaybackSpeed(speed: number): void {
    if (!this.video) return;
    this.video.playbackRate = speed;
    this.emitPreference('playbackRate', speed);

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

    if (isFullscreen(this.host)) {
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
    this.updateLoopUi();
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
    if (this.elements.cancelBtn) {
      this.elements.cancelBtn.style.display = this.player?.stop && on ? 'inline-flex' : 'none';
    }
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

  private setStatusMessage(message: string, detail = '', retry = false, transient = false): void {
    if (!this.showStatusOverlay) return;
    const statusMessage = this.elements.statusMessage;
    if (!statusMessage) return;
    statusMessage.textContent = message;
    this.elements.statusCard?.classList.toggle('show', message.length > 0);
    if (this.elements.statusDetail) {
      this.elements.statusDetail.textContent = detail;
      this.elements.statusDetail.style.display = detail ? 'block' : 'none';
    }
    if (this.elements.retryBtn) {
      this.elements.retryBtn.style.display = retry ? 'inline-flex' : 'none';
    }
    if (this.elements.cancelBtn) {
      this.elements.cancelBtn.style.display = this.player?.stop && message && !retry ? 'inline-flex' : 'none';
    }
    if (transient && message) {
      window.setTimeout(() => {
        if (this.elements.statusMessage?.textContent === message) {
          this.setStatusMessage('');
        }
      }, 1600);
    }
  }

  private updateLoopUi(): void {
    const available = !this.stopped && !!this.video && Number.isFinite(this.video.duration) && this.video.duration > 0;
    this.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-act="loop"]').forEach(button => {
      button.style.display = available && (!button.classList.contains('collapsible') || !this.isSmallMode) ? '' : 'none';
      button.setAttribute('aria-pressed', String(!!this.video?.loop));
      button.title = this.video?.loop ? '关闭循环播放' : '循环播放';
      button.setAttribute('aria-label', button.title);
    });
  }

  private populateQuality(): void {
    if (!this.elements.qualitySel) return;
    const qualityState = this.player?.getQualityState?.();
    if (qualityState?.supported && qualityState.levels.length > 1) {
      this.elements.qualitySel.style.display = 'block';
      this.elements.qualitySel.dataset.mode = 'quality';
      this.elements.qualitySel.setAttribute('aria-label', '画质');
      this.elements.qualitySel.innerHTML = '';

      const auto = document.createElement('option');
      auto.value = 'auto';
      auto.textContent = 'Auto';
      this.elements.qualitySel.appendChild(auto);

      qualityState.levels.forEach((level) => {
        const opt = document.createElement('option');
        opt.value = String(level.id);
        opt.textContent = this.getQualityLabel(level);
        this.elements.qualitySel?.appendChild(opt);
      });

      this.elements.qualitySel.value =
        qualityState.auto || qualityState.current == null ? 'auto' : String(qualityState.current);
      this.syncQualityMenu();
      return;
    }

    const sources = this.getPlayerSources();
    if (!sources.length || sources.length === 1) {
      this.elements.qualitySel.style.display = 'none';
      this.elements.qualitySel.dataset.mode = '';
      this.elements.qualitySel.innerHTML = '';
      this.syncQualityMenu();
      return;
    }
    this.elements.qualitySel.style.display = 'block';
    this.elements.qualitySel.dataset.mode = 'source';
    this.elements.qualitySel.setAttribute('aria-label', '播放源');
    this.elements.qualitySel.innerHTML = '';
    const currentSource = this.player?.getCurrentSource?.();
    const current = currentSource ? sources.indexOf(currentSource) : -1;
    sources.forEach((s, idx) => {
      const opt = document.createElement('option');
      const label = this.getSourceLabel(s, idx);
      opt.value = String(idx);
      opt.textContent = label;
      this.elements.qualitySel?.appendChild(opt);
    });
    if (current >= 0) this.elements.qualitySel.value = String(current);
    this.syncQualityMenu();
  }

  private syncQualityMenu(): void {
    this.updateOptionalControlVisibility();
    const original = this.elements.qualitySel;
    const menu = this.shadowRoot?.querySelector('.quality-more') as HTMLSelectElement | null;
    if (!original || !menu) return;
    menu.innerHTML = original.innerHTML;
    menu.value = original.value;
    if (menu.parentElement) menu.parentElement.style.display = original.dataset.mode ? 'block' : 'none';
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
if (typeof customElements !== 'undefined' && !customElements.get('fyra-ui-shell')) {
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
    const previousVideoControls = video.controls;
    const hadControlsAttribute = video.hasAttribute?.('controls') ?? previousVideoControls;
    const previousHostPosition = host.style.position;
    const hadContainerClass = host.classList.contains('fyra-player-container');

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

    return {
      destroy: () => {
        shell.remove();

        video.controls = previousVideoControls;
        if (hadControlsAttribute) {
          video.setAttribute('controls', '');
        } else {
          video.removeAttribute('controls');
        }

        if (!hadContainerClass) {
          host.classList.remove('fyra-player-container');
        }
        host.style.position = previousHostPosition || '';
      }
    };
  };
}
