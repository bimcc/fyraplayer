import type { PluginContext } from '../src/types.js';

class ClassListStub {
  private readonly values = new Set<string>();

  add(value: string): void {
    this.values.add(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }

  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class ElementStub {
  readonly style: Record<string, string> = {};
  readonly classList = new ClassListStub();
  readonly children: ElementStub[] = [];
  readonly attributes = new Set<string>();
  parentElement: ElementStub | null = null;

  constructor(public readonly tagName: string) {}

  appendChild(child: ElementStub): ElementStub {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    const parent = this.parentElement;
    if (!parent) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parentElement = null;
  }

  querySelector(selector: string): ElementStub | null {
    if (selector === 'video') {
      return this.children.find((child) => child.tagName === 'video') ?? null;
    }
    if (selector === 'fyra-ui-shell') {
      return this.children.find((child) => child.tagName === 'fyra-ui-shell') ?? null;
    }
    return null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string): void {
    this.attributes.add(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

class VideoStub extends ElementStub {
  controls = true;

  constructor() {
    super('video');
    this.attributes.add('controls');
  }
}

describe('createUiComponentsPlugin lifecycle', () => {
  const originalDocument = globalThis.document;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalCustomElements = globalThis.customElements;
  const originalGetComputedStyle = globalThis.getComputedStyle;

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', { value: originalDocument, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: originalHTMLElement, configurable: true });
    Object.defineProperty(globalThis, 'customElements', { value: originalCustomElements, configurable: true });
    Object.defineProperty(globalThis, 'getComputedStyle', { value: originalGetComputedStyle, configurable: true });
  });

  test('removes shell and restores host/video state on destroy', async () => {
    const host = new ElementStub('div');
    const video = new VideoStub();
    host.appendChild(video);

    const documentStub = {
      querySelector: (selector: string) => selector === '.player-shell' ? host : null,
      createElement: (tagName: string) => new ElementStub(tagName),
      getElementById: () => ({}),
      head: new ElementStub('head'),
    };

    Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true });
    Object.defineProperty(globalThis, 'HTMLElement', { value: ElementStub, configurable: true });
    Object.defineProperty(globalThis, 'customElements', {
      value: { get: () => true, define: () => undefined },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'getComputedStyle', {
      value: () => ({ position: 'static' }),
      configurable: true,
    });

    const { createUiComponentsPlugin } = await import('../src/ui/shell.js');
    const plugin = createUiComponentsPlugin({ target: '.player-shell' });
    const lifecycle = plugin({
      player: {},
      coreBus: {},
      techs: {},
      storage: null,
    } as PluginContext);

    expect(video.controls).toBe(false);
    expect(video.hasAttribute('controls')).toBe(false);
    expect(host.classList.contains('fyra-player-container')).toBe(true);
    expect(host.querySelector('fyra-ui-shell')).not.toBeNull();

    lifecycle?.destroy?.();

    expect(host.querySelector('fyra-ui-shell')).toBeNull();
    expect(video.controls).toBe(true);
    expect(video.hasAttribute('controls')).toBe(true);
    expect(host.classList.contains('fyra-player-container')).toBe(false);
    expect(host.style.position).toBe('');
  });
});
