/** Container fullscreen shared by normal and panorama controls, without UI imports. */
export const FULLSCREEN_CHANGE_EVENT = 'fyra-page-fullscreenchange';
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenTarget = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
let pendingRequest: { target: HTMLElement; cancelled: boolean } | null = null;
let pageFullscreen: {
  target: HTMLElement;
  overflow: Array<{ style: CSSStyleDeclaration; value: string; priority: string }>;
  escape: (event: KeyboardEvent) => void;
} | null = null;

export function getFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? pageFullscreen?.target ?? null;
}

function leavePageFullscreen(): void {
  const state = pageFullscreen;
  if (!state) return;
  pageFullscreen = null;
  state.target.removeAttribute('data-fyra-page-fullscreen');
  state.overflow.forEach(({ style, value, priority }) => {
    if (value) style.setProperty('overflow', value, priority);
    else style.removeProperty('overflow');
  });
  document.removeEventListener('keydown', state.escape);
  document.dispatchEvent(new Event(FULLSCREEN_CHANGE_EVENT));
}

export async function releaseFullscreen(target: HTMLElement): Promise<void> {
  if (pendingRequest?.target === target) pendingRequest.cancelled = true;
  if (pageFullscreen?.target === target) { leavePageFullscreen(); return; }
  const doc = document as FullscreenDocument;
  if ((doc.fullscreenElement ?? doc.webkitFullscreenElement) !== target) return;
  if (doc.exitFullscreen) await doc.exitFullscreen();
  else await doc.webkitExitFullscreen?.();
}

export async function toggleContainerFullscreen(target: HTMLElement): Promise<void> {
  if (getFullscreenElement() === target || pendingRequest?.target === target) {
    await releaseFullscreen(target);
    return;
  }
  if (pendingRequest) pendingRequest.cancelled = true;
  const request = { target, cancelled: false };
  pendingRequest = request;
  try {
    await enterFullscreen(target, request);
  } finally {
    if (pendingRequest === request) pendingRequest = null;
  }
}

async function enterFullscreen(target: HTMLElement, request: { cancelled: boolean }): Promise<void> {
  const current = getFullscreenElement();
  if (current) await releaseFullscreen(current as HTMLElement);
  if (request.cancelled || !target.isConnected) return;
  injectContainerFullscreenStyles();
  target.setAttribute('data-fyra-fullscreen-host', '');
  const nativeTarget = target as FullscreenTarget;
  try {
    const nativeRequest = nativeTarget.requestFullscreen ?? nativeTarget.webkitRequestFullscreen;
    if (nativeRequest) {
      await nativeRequest.call(nativeTarget);
      if (request.cancelled || !target.isConnected) await releaseFullscreen(target);
      return;
    }
  } catch { /* Embedded/mobile browsers may forbid container fullscreen. */ }
  if (request.cancelled || !target.isConnected) return;
  const overflow = [document.documentElement, document.body].map(element => ({
    style: element.style,
    value: element.style.getPropertyValue('overflow'),
    priority: element.style.getPropertyPriority('overflow'),
  }));
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') leavePageFullscreen(); };
  pageFullscreen = { target, overflow, escape };
  overflow.forEach(({ style }) => style.setProperty('overflow', 'hidden', 'important'));
  target.setAttribute('data-fyra-page-fullscreen', '');
  document.addEventListener('keydown', escape);
  document.dispatchEvent(new Event(FULLSCREEN_CHANGE_EVENT));
}

export function injectContainerFullscreenStyles(): void {
  if (document.getElementById('fyra-fullscreen-styles')) return;
  const style = document.createElement('style');
  style.id = 'fyra-fullscreen-styles';
  const hosts = [
    '[data-fyra-fullscreen-host]:fullscreen',
    '[data-fyra-fullscreen-host]:-webkit-full-screen',
    '[data-fyra-page-fullscreen]',
    '.fyra-player-container:fullscreen',
    '.fyra-player-container:-webkit-full-screen',
  ];
  // Keep prefixed selectors in separate rules so an unsupported selector cannot
  // invalidate the standard and page-fullscreen rules in another browser.
  style.textContent = hosts.map(host => `
    ${host} {
      position: fixed !important; inset: 0 !important;
      box-sizing: border-box !important;
      width: 100% !important; height: 100vh !important; height: 100dvh !important;
      max-width: none !important; max-height: none !important;
      margin: 0 !important; border-radius: 0 !important;
      background: #000 !important;
    }
    ${host} video, ${host} canvas {
      position: absolute !important; inset: 0 !important;
      width: 100% !important; height: 100% !important;
      max-width: none !important; max-height: none !important;
      min-height: 0 !important; aspect-ratio: auto !important; object-fit: contain !important;
      margin: 0 !important;
    }
    ${host} fyra-ui-shell {
      position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important;
    }
  `).join('\n') + '[data-fyra-page-fullscreen] { z-index: 2147483647 !important; }';
  document.head.appendChild(style);
}
