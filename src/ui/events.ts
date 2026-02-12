/**
 * FyraPlayer UI Event Handlers
 * Event binding and cleanup utilities
 */

import type { PluginContext } from '../types.js';

type BusHandler = Parameters<PluginContext['coreBus']['on']>[1];

export interface EventCleanup {
  videoHandlers: Map<string, EventListener>;
  busHandlers: Map<string, BusHandler>;
  domCleanups: Array<() => void>;
}

/**
 * Create event cleanup tracker
 */
export function createEventCleanup(): EventCleanup {
  return {
    videoHandlers: new Map(),
    busHandlers: new Map(),
    domCleanups: [],
  };
}

/**
 * Add video event listener with tracking
 */
export function addVideoListener(
  video: HTMLVideoElement,
  event: string,
  handler: EventListener,
  cleanup: EventCleanup
): void {
  video.addEventListener(event, handler);
  cleanup.videoHandlers.set(event, handler);
}

/**
 * Add bus event listener with tracking
 */
export function addBusListener(
  bus: PluginContext['coreBus'],
  event: string,
  handler: BusHandler,
  cleanup: EventCleanup
): void {
  bus.on(event, handler);
  cleanup.busHandlers.set(event, handler);
}

/**
 * Add DOM event listener with cleanup tracking
 */
export function addDomListener(
  element: EventTarget,
  event: string,
  handler: EventListener,
  cleanup: EventCleanup
): void {
  element.addEventListener(event, handler);
  cleanup.domCleanups.push(() => element.removeEventListener(event, handler));
}

/**
 * Clean up all tracked event listeners
 */
export function cleanupEvents(
  video: HTMLVideoElement | null,
  bus: PluginContext['coreBus'] | null,
  cleanup: EventCleanup
): void {
  // Remove video event listeners
  if (video) {
    cleanup.videoHandlers.forEach((handler, event) => {
      video.removeEventListener(event, handler);
    });
  }
  cleanup.videoHandlers.clear();

  // Remove bus event listeners
  if (bus) {
    cleanup.busHandlers.forEach((handler, event) => {
      bus.off(event, handler);
    });
  }
  cleanup.busHandlers.clear();

  // Remove DOM event listeners
  cleanup.domCleanups.forEach((fn) => fn());
  cleanup.domCleanups = [];
}

/**
 * Bind video playback events
 */
export function bindVideoEvents(
  video: HTMLVideoElement,
  cleanup: EventCleanup,
  callbacks: {
    onTimeUpdate: () => void;
    onDurationChange: () => void;
    onPlay: () => void;
    onPause: () => void;
    onPlaying: () => void;
    onWaiting: () => void;
    onCanPlay: () => void;
  }
): void {
  addVideoListener(video, 'timeupdate', callbacks.onTimeUpdate, cleanup);
  addVideoListener(video, 'durationchange', callbacks.onDurationChange, cleanup);
  addVideoListener(video, 'play', callbacks.onPlay, cleanup);
  addVideoListener(video, 'pause', callbacks.onPause, cleanup);
  addVideoListener(video, 'playing', callbacks.onPlaying, cleanup);
  addVideoListener(video, 'waiting', callbacks.onWaiting, cleanup);
  addVideoListener(video, 'canplay', callbacks.onCanPlay, cleanup);
}

/**
 * Bind player bus events
 */
export function bindBusEvents(
  bus: PluginContext['coreBus'],
  cleanup: EventCleanup,
  callbacks: {
    onReady: () => void;
    onPlay: () => void;
    onPause: () => void;
    onBuffer: () => void;
    onError: (e: unknown) => void;
    onNetwork: (e: unknown) => void;
    onStats: (e: unknown) => void;
  }
): void {
  addBusListener(bus, 'ready', callbacks.onReady, cleanup);
  addBusListener(bus, 'play', callbacks.onPlay, cleanup);
  addBusListener(bus, 'pause', callbacks.onPause, cleanup);
  addBusListener(bus, 'buffer', callbacks.onBuffer, cleanup);
  addBusListener(bus, 'error', callbacks.onError, cleanup);
  addBusListener(bus, 'network', callbacks.onNetwork, cleanup);
  addBusListener(bus, 'stats', callbacks.onStats, cleanup);
}
