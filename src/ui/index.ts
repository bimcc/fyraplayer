/**
 * FyraPlayer UI Module
 * Main entry point - re-exports all UI components and utilities
 */

// Main exports
export { FyraUiShell, createUiComponentsPlugin } from './shell.js';

// Types
export type {
  UiComponentsOptions,
  UiElements,
  UiShellElements,
  UiShellState,
  OriginalStyles,
  FullscreenHandler,
} from './types.js';

// Styles
export { UI_SHELL_STYLES, UI_SHELL_HTML } from './styles.js';

// Controls
export {
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

// Fullscreen
export { createFullscreenHandler, injectFullscreenStyles } from './fullscreen.js';

// Events
export {
  createEventCleanup,
  cleanupEvents,
  bindVideoEvents,
  bindBusEvents,
  addVideoListener,
  addBusListener,
  addDomListener,
  type EventCleanup,
} from './events.js';
