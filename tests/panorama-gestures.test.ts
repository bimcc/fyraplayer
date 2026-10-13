import { createPanoramaLiteControls } from '../src/plugins/panoramalite/input/controls.js';
import type { PanoramaLiteView } from '../src/plugins/panoramalite/types.js';

class Target extends EventTarget {
  style = { touchAction: 'pan-y' };
  setPointerCapture = jest.fn();
  releasePointerCapture = jest.fn();
}
function dispatch(target: Target, type: string, properties: Record<string, unknown>) {
  target.dispatchEvent(Object.assign(new Event(type, {cancelable:true}), properties));
}
function setup(pointer = true) {
  Object.defineProperty(globalThis, 'PointerEvent', {value:pointer ? Event : undefined,configurable:true});
  const target = new Target();
  let view: PanoramaLiteView = {yaw:0,pitch:0,roll:0,fov:75};
  const setView = jest.fn((patch: Partial<PanoramaLiteView>) => {view = {...view,...patch};});
  const controls = createPanoramaLiteControls({element:target as unknown as HTMLElement,getView:()=>view,setView});
  const pointerEvent = (type: string, id: number, x: number, y = 0) => dispatch(target,type,{pointerId:id,clientX:x,clientY:y,pointerType:'touch'});
  return {target,controls,setView,pointerEvent,getView:()=>view};
}

describe('panorama mobile gestures', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis,'PointerEvent');
  afterEach(() => {
    if(original) Object.defineProperty(globalThis,'PointerEvent',original);
    else Reflect.deleteProperty(globalThis,'PointerEvent');
  });
  test('uses one touch pointer path and does not also pan for compatibility Touch events', () => {
    const s = setup(); s.pointerEvent('pointerdown',1,0); s.pointerEvent('pointermove',1,100,50);
    expect(s.getView()).toMatchObject({yaw:-18,pitch:9});
    dispatch(s.target,'touchstart',{changedTouches:[{identifier:1,clientX:0,clientY:0}]});
    dispatch(s.target,'touchmove',{changedTouches:[{identifier:1,clientX:100,clientY:50}]});
    expect(s.setView).toHaveBeenCalledTimes(1); s.controls.destroy();
  });
  test('pinches without rotating and continues smoothly when one finger leaves', () => {
    const s = setup(); s.pointerEvent('pointerdown',1,0); s.pointerEvent('pointerdown',2,100);
    s.pointerEvent('pointermove',2,150);
    expect(s.getView()).toMatchObject({yaw:0,pitch:0,fov:71});
    s.pointerEvent('pointerup',2,150); s.pointerEvent('pointermove',1,10);
    expect(s.getView().yaw).toBeCloseTo(-1.8); expect(s.getView().fov).toBe(71); s.controls.destroy();
  });
  test.each(['pointercancel','lostpointercapture'])('%s clears a drag and a subsequent move has no effect', event => {
    const s = setup(); s.pointerEvent('pointerdown',1,0); s.pointerEvent(event,1,0); s.pointerEvent('pointermove',1,20);
    expect(s.setView).not.toHaveBeenCalled(); s.controls.destroy();
  });
  test('disabling clears contacts; destroy restores the host touch behavior', () => {
    const s = setup(); s.pointerEvent('pointerdown',1,0); s.controls.setEnabled(false);
    expect(s.target.style.touchAction).toBe('pan-y');
    s.controls.setEnabled(true); s.pointerEvent('pointermove',1,20);
    expect(s.setView).not.toHaveBeenCalled(); s.controls.destroy();
    expect(s.target.style.touchAction).toBe('pan-y');
  });
  test('Touch fallback pans once, pinches, and cleans up', () => {
    const s = setup(false);
    const touch = (identifier:number,clientX:number) => ({identifier,clientX,clientY:0});
    dispatch(s.target,'touchstart',{changedTouches:[touch(1,0)]});
    dispatch(s.target,'touchmove',{changedTouches:[touch(1,10)]});
    expect(s.getView().yaw).toBeCloseTo(-1.8);
    dispatch(s.target,'touchstart',{changedTouches:[touch(2,100)]});
    dispatch(s.target,'touchmove',{changedTouches:[touch(1,0),touch(2,150)]});
    expect(s.getView().yaw).toBeCloseTo(-1.8); expect(s.getView().fov).toBeCloseTo(70.2);
    s.controls.destroy(); dispatch(s.target,'touchmove',{changedTouches:[touch(1,40)]});
    expect(s.setView).toHaveBeenCalledTimes(2);
  });
});
