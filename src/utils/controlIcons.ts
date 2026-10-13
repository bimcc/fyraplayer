/** Static SVG controls, independent of UI components and icon fonts. */
const paths = {
  play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="4"/>',
  reset: '<path d="M3 10a9 9 0 1 1 3 9M3 4v6h6"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 5 6 9H3v6h3l5 4ZM16 9l5 6M21 9l-5 6"/>',
  fullscreen: '<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  exitFullscreen: '<path d="M3 8h5V3M21 8h-5V3M16 21v-5h5M3 16h5v5"/>',
} as const;

export type ControlIcon = keyof typeof paths;

export function controlIconSvg(icon: ControlIcon): string {
  return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[icon]}</svg>`;
}
