import type { PanoramaLiteView } from '../types.js';

export interface PanoramaLiteControlsOptions {
  element: HTMLElement;
  getView: () => PanoramaLiteView;
  setView: (view: Partial<PanoramaLiteView>) => void;
  enabled?: boolean;
}

export interface PanoramaLiteControls {
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

/** Pointer gestures (including pinch), with Touch fallback for older browsers. */
export function createPanoramaLiteControls(options: PanoramaLiteControlsOptions): PanoramaLiteControls {
  let enabled = options.enabled !== false;
  const points = new Map<number, { x: number; y: number }>();
  const usesPointer = typeof globalThis.PointerEvent !== 'undefined';
  const disposers: Array<() => void> = [];
  const originalTouchAction = options.element.style.touchAction;
  options.element.style.touchAction = enabled ? 'none' : originalTouchAction;
  const distance = () => {
    const [a, b] = [...points.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };
  const move = (id: number, x: number, y: number) => {
    const previous = points.get(id);
    if (!enabled || !previous) return;
    const before = distance();
    const dx = x - previous.x, dy = y - previous.y;
    points.set(id, { x, y });
    const after = distance();
    const view = options.getView();
    if (before !== null && after !== null) {
      options.setView({ fov: view.fov - (after - before) * 0.08 });
    } else {
      options.setView({ yaw: view.yaw - dx * 0.18, pitch: view.pitch + dy * 0.18 });
    }
  };
  const reset = () => {
    for (const id of points.keys()) {
      try { options.element.releasePointerCapture?.(id); } catch { /* no active capture */ }
    }
    points.clear();
  };
  const listen = (type: string, handler: EventListener, opts?: AddEventListenerOptions) => {
    options.element.addEventListener(type, handler, opts);
    disposers.push(() => options.element.removeEventListener(type, handler, opts));
  };
  if (usesPointer) {
    listen('pointerdown', ((event: PointerEvent) => {
      if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      points.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try { options.element.setPointerCapture?.(event.pointerId); } catch { /* synthetic pointer */ }
    }) as EventListener);
    listen('pointermove', ((event: PointerEvent) => move(event.pointerId, event.clientX, event.clientY)) as EventListener);
    const end = ((event: PointerEvent) => {
      points.delete(event.pointerId);
      try { options.element.releasePointerCapture?.(event.pointerId); } catch { /* no active capture */ }
    }) as EventListener;
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(event, end);
  } else {
    listen('touchstart', ((event: TouchEvent) => {
      if (!enabled) return;
      for (const touch of Array.from(event.changedTouches)) points.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }) as EventListener, { passive: true });
    listen('touchmove', ((event: TouchEvent) => {
      if (!enabled) return;
      event.preventDefault();
      // Update both fingers together to avoid applying a pinch as two separate pans.
      const before = distance();
      if (points.size >= 2) {
        for (const touch of Array.from(event.changedTouches)) points.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        const after = distance();
        if (before !== null && after !== null) options.setView({ fov: options.getView().fov - (after - before) * 0.08 });
      } else {
        for (const touch of Array.from(event.changedTouches)) move(touch.identifier, touch.clientX, touch.clientY);
      }
    }) as EventListener, { passive: false });
    const end = ((event: TouchEvent) => {
      for (const touch of Array.from(event.changedTouches)) points.delete(touch.identifier);
    }) as EventListener;
    listen('touchend', end); listen('touchcancel', end);
  }
  listen('wheel', ((event: WheelEvent) => {
    if (!enabled) return;
    event.preventDefault();
    options.setView({ fov: options.getView().fov + event.deltaY * 0.04 });
  }) as EventListener, { passive: false });
  return {
    setEnabled(value) {
      enabled = value; reset();
      options.element.style.touchAction = value ? 'none' : originalTouchAction;
    },
    destroy() {
      reset(); disposers.forEach(dispose => dispose());
      options.element.style.touchAction = originalTouchAction;
    },
  };
}
