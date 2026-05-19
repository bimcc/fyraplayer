/**
 * FyraPlayer UI Types
 */
import type { PlayerAPI, PluginContext } from '../types.js';

export interface UiActionContext {
  player: PlayerAPI;
  video: HTMLVideoElement;
}

export interface UiScreenshotEvent extends UiActionContext {
  blob: Blob;
  width: number;
  height: number;
  filename: string;
  ts: number;
}

export interface UiRecordToggleEvent extends UiActionContext {
  recording: boolean;
  ts: number;
}

export interface UiComponentsOptions {
  target?: HTMLElement | string;
  showLog?: boolean;
  poster?: string;
  /** Show user-facing error/reconnect overlay. Defaults to true. */
  showStatusOverlay?: boolean;
  /** Called when the status overlay retry button is clicked. Defaults to player.play(). */
  onRetry?: () => void | Promise<void>;
  /** Show a diagnostics button. Defaults to true when onDiagnostics is provided. */
  showDiagnosticsButton?: boolean;
  /** Called when the diagnostics button is clicked. */
  onDiagnostics?: (context: UiActionContext) => void | Promise<void>;
  /** Called after a screenshot has been captured and downloaded. */
  onScreenshot?: (event: UiScreenshotEvent) => void | Promise<void>;
  /** Show a recording toggle button. Defaults to false. */
  showRecordingButton?: boolean;
  /** Called when the recording toggle button changes state. Actual recording stays product-owned. */
  onRecordToggle?: (event: UiRecordToggleEvent) => void | Promise<void>;
}

/** UI element references (used internally by shell.ts) */
export interface UiElements {
  logBox: HTMLElement | null;
  bigPlay: HTMLElement | null;
  playBtn: HTMLElement | null;
  timeLabel: HTMLElement | null;
  spinner: HTMLElement | null;
  statusCard: HTMLElement | null;
  statusMessage: HTMLElement | null;
  statusDetail: HTMLElement | null;
  retryBtn: HTMLElement | null;
  diagnosticsBtn: HTMLElement | null;
  diagnosticsMenuBtn: HTMLElement | null;
  recordBtn: HTMLElement | null;
  recordMenuBtn: HTMLElement | null;
  qualitySel: HTMLSelectElement | null;
  cover: HTMLElement | null;
  speedBtn: HTMLElement | null;
}

/** @deprecated Use UiElements instead */
export type UiShellElements = UiElements & { shell: HTMLElement | null };

export interface UiShellState {
  player: PlayerAPI | null;
  video: HTMLVideoElement | null;
  bus: PluginContext['coreBus'] | null;
  host: HTMLElement | null;
  logEnabled: boolean;
  loading: boolean;
  duration: number;
}

export interface OriginalStyles {
  video: Record<string, string>;
  host: Record<string, string>;
  shell: Record<string, string>;
}

/** Fullscreen handler interface */
export interface FullscreenHandler {
  attach: () => void;
  detach: () => void;
}
