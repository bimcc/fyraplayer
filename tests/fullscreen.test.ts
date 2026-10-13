import { FULLSCREEN_CHANGE_EVENT, getFullscreenElement, releaseFullscreen, toggleContainerFullscreen } from '../src/utils/fullscreen.js';
import { createFullscreenHandler } from '../src/ui/fullscreen.js';

function style() {
  const values = new Map<string,{value:string,priority:string}>();
  return {
    getPropertyValue: (key:string) => values.get(key)?.value ?? '',
    getPropertyPriority: (key:string) => values.get(key)?.priority ?? '',
    setProperty: (key:string,value:string,priority='') => {values.set(key,{value,priority});},
    removeProperty: (key:string) => values.delete(key),
  };
}
class Host extends EventTarget {
  readonly attrs = new Map<string,string>();
  readonly style = style();
  isConnected = true;
  setAttribute(key:string,value:string) {this.attrs.set(key,value);}
  removeAttribute(key:string) {this.attrs.delete(key);}
}
class Doc extends EventTarget {
  fullscreenElement: Host | null = null;
  webkitFullscreenElement: Host | null = null;
  documentElement = {style:style()};
  body = {style:style()};
  head = {appendChild:jest.fn()};
  getElementById() {return null;}
  createElement() {return {id:'',textContent:''};}
  exitFullscreen = jest.fn(async () => {this.fullscreenElement=null;this.dispatchEvent(new Event('fullscreenchange'));});
}
const html = (host:Host) => host as unknown as HTMLElement;
describe('fullscreen ownership and mobile fallback', () => {
  const original = globalThis.document;
  let doc: Doc, host: Host;
  beforeEach(() => {doc=new Doc();host=new Host();Object.defineProperty(globalThis,'document',{value:doc,configurable:true});});
  afterEach(async () => {await releaseFullscreen(html(host));Object.defineProperty(globalThis,'document',{value:original,configurable:true});});
  test('page mode restores overflow with its original priority and keeps application styles intact', async () => {
    doc.body.style.setProperty('overflow','scroll','important');
    host.style.setProperty('border-radius','12px');
    const observer = jest.fn(); doc.addEventListener(FULLSCREEN_CHANGE_EVENT,observer);
    await toggleContainerFullscreen(html(host));
    expect(getFullscreenElement()).toBe(host);expect(host.attrs.has('data-fyra-page-fullscreen')).toBe(true);
    expect(doc.body.style.getPropertyValue('overflow')).toBe('hidden');
    await toggleContainerFullscreen(html(host));
    expect(getFullscreenElement()).toBeNull();expect(doc.body.style.getPropertyValue('overflow')).toBe('scroll');
    expect(doc.body.style.getPropertyPriority('overflow')).toBe('important');
    expect(doc.documentElement.style.getPropertyValue('overflow')).toBe('');
    expect(host.style.getPropertyValue('border-radius')).toBe('12px');expect(observer).toHaveBeenCalledTimes(2);
  });
  test('a rejected native request falls back; Escape leaves page mode', async () => {
    Object.assign(host,{requestFullscreen:jest.fn().mockRejectedValue(new DOMException('Denied','NotAllowedError'))});
    await toggleContainerFullscreen(html(host));expect(getFullscreenElement()).toBe(host);
    doc.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));
    expect(getFullscreenElement()).toBeNull();
  });
  test('standard and prefixed requests are used when available', async () => {
    const requestFullscreen = jest.fn(async()=>{doc.fullscreenElement=host;});Object.assign(host,{requestFullscreen});
    await toggleContainerFullscreen(html(host));expect(requestFullscreen).toHaveBeenCalledTimes(1);
    await toggleContainerFullscreen(html(host));expect(doc.exitFullscreen).toHaveBeenCalledTimes(1);
    Reflect.deleteProperty(host,'requestFullscreen');
    const webkitRequestFullscreen=jest.fn(async()=>{doc.webkitFullscreenElement=host;});
    Object.assign(host,{webkitRequestFullscreen});
    Object.assign(doc,{exitFullscreen:undefined,webkitExitFullscreen:jest.fn(async()=>{doc.webkitFullscreenElement=null;})});
    await toggleContainerFullscreen(html(host));expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1);
    await toggleContainerFullscreen(html(host));expect(getFullscreenElement()).toBeNull();
  });
  test('another player cannot release this fullscreen; owner teardown releases page mode', async () => {
    await toggleContainerFullscreen(html(host));await releaseFullscreen(html(new Host()));
    expect(getFullscreenElement()).toBe(host);
    const changed=jest.fn();const handler=createFullscreenHandler(null,html(host),html(new Host()),changed);
    handler.attach();handler.detach();
    expect(getFullscreenElement()).toBeNull();expect(changed).not.toHaveBeenCalled();
    doc.dispatchEvent(new Event('fullscreenchange'));expect(changed).not.toHaveBeenCalled();
  });
  test.each([true, false])('teardown cancels an outstanding native request (rejected=%s)', async rejected => {
    let settle!: () => void;
    Object.assign(host, {requestFullscreen: () => new Promise<void>((resolve, reject) => {
      settle = () => { if (rejected) reject(new Error('Denied')); else { doc.fullscreenElement = host; resolve(); } };
    })});
    const entering = toggleContainerFullscreen(html(host));
    await releaseFullscreen(html(host));
    settle(); await entering;
    expect(getFullscreenElement()).toBeNull();
    expect(host.attrs.has('data-fyra-page-fullscreen')).toBe(false);
    expect(doc.body.style.getPropertyValue('overflow')).toBe('');
  });
  test('a late rejection from another player cannot replace the current page fullscreen', async () => {
    let reject!: (error: Error) => void;
    Object.assign(host, {requestFullscreen: () => new Promise<void>((_resolve, fail) => { reject = fail; })});
    const first = toggleContainerFullscreen(html(host));
    const second = new Host();
    await toggleContainerFullscreen(html(second));
    reject(new Error('Denied')); await first;
    expect(getFullscreenElement()).toBe(second);
    expect(host.attrs.has('data-fyra-page-fullscreen')).toBe(false);
    await releaseFullscreen(html(second));
    expect(doc.body.style.getPropertyValue('overflow')).toBe('');
  });
});
