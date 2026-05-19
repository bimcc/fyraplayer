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

export function createPanoramaLiteControls(options: PanoramaLiteControlsOptions): PanoramaLiteControls {
  let enabled = options.enabled !== false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const activeTouches = new Map<number, { x: number; y: number }>();
  let lastPinchDistance: number | null = null;

  const onPointerDown = (event: PointerEvent) => {
    if (!enabled) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    options.element.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!enabled || !dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    const view = options.getView();
    options.setView({
      yaw: view.yaw - dx * 0.18,
      pitch: view.pitch + dy * 0.18,
    });
  };
  const onPointerUp = (event: PointerEvent) => {
    dragging = false;
    options.element.releasePointerCapture?.(event.pointerId);
  };
  const onWheel = (event: WheelEvent) => {
    if (!enabled) return;
    event.preventDefault();
    const view = options.getView();
    options.setView({ fov: view.fov + event.deltaY * 0.04 });
  };
  const onTouchStart = (event: TouchEvent) => {
    if (!enabled) return;
    for (const touch of Array.from(event.changedTouches)) {
      activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    }
    lastPinchDistance = getPinchDistance();
  };
  const onTouchMove = (event: TouchEvent) => {
    if (!enabled) return;
    event.preventDefault();
    if (activeTouches.size >= 2) {
      for (const touch of Array.from(event.changedTouches)) {
        activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
      }
      const nextDistance = getPinchDistance();
      if (nextDistance !== null && lastPinchDistance !== null) {
        const view = options.getView();
        options.setView({ fov: view.fov - (nextDistance - lastPinchDistance) * 0.08 });
      }
      lastPinchDistance = nextDistance;
      return;
    }
    const touch = event.changedTouches[0];
    const previous = activeTouches.get(touch.identifier);
    if (!previous) return;
    const dx = touch.clientX - previous.x;
    const dy = touch.clientY - previous.y;
    activeTouches.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
    const view = options.getView();
    options.setView({
      yaw: view.yaw - dx * 0.18,
      pitch: view.pitch + dy * 0.18,
    });
  };
  const onTouchEnd = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      activeTouches.delete(touch.identifier);
    }
    lastPinchDistance = getPinchDistance();
  };

  function getPinchDistance(): number | null {
    const touches = Array.from(activeTouches.values());
    if (touches.length < 2) return null;
    const [a, b] = touches;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  options.element.addEventListener('pointerdown', onPointerDown);
  options.element.addEventListener('pointermove', onPointerMove);
  options.element.addEventListener('pointerup', onPointerUp);
  options.element.addEventListener('pointercancel', onPointerUp);
  options.element.addEventListener('wheel', onWheel, { passive: false });
  options.element.addEventListener('touchstart', onTouchStart, { passive: false });
  options.element.addEventListener('touchmove', onTouchMove, { passive: false });
  options.element.addEventListener('touchend', onTouchEnd);
  options.element.addEventListener('touchcancel', onTouchEnd);

  return {
    setEnabled(value: boolean) {
      enabled = value;
    },
    destroy() {
      options.element.removeEventListener('pointerdown', onPointerDown);
      options.element.removeEventListener('pointermove', onPointerMove);
      options.element.removeEventListener('pointerup', onPointerUp);
      options.element.removeEventListener('pointercancel', onPointerUp);
      options.element.removeEventListener('wheel', onWheel);
      options.element.removeEventListener('touchstart', onTouchStart);
      options.element.removeEventListener('touchmove', onTouchMove);
      options.element.removeEventListener('touchend', onTouchEnd);
      options.element.removeEventListener('touchcancel', onTouchEnd);
      activeTouches.clear();
    },
  };
}

