/**
 * FyraPlayer UI Components Plugin
 * Entry point - re-exports from ui/ module for backward compatibility
 */

// Main exports
export { FyraUiShell, createUiComponentsPlugin } from '../ui/index.js';
export { createUiComponentsPlugin as default } from '../ui/index.js';

// Types
export type { UiComponentsOptions } from '../ui/index.js';
