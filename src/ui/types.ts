/**
 * FyraPlayer UI Types
 */
import type { PlayerAPI, PluginContext } from '../types.js';

export interface UiComponentsOptions {
  target?: HTMLElement | string;
  showLog?: boolean;
  poster?: string;
}

/** UI element references (used internally by shell.ts) */
export interface UiElements {
  logBox: HTMLElement | null;
  bigPlay: HTMLElement | null;
  playBtn: HTMLElement | null;
  timeLabel: HTMLElement | null;
  spinner: HTMLElement | null;
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
