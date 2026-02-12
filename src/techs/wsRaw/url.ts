/**
 * Validate WebSocket URL format.
 * Only ws:// and wss:// protocols are allowed.
 */
export function isValidWebSocketUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'ws:' || parsed.protocol === 'wss:';
  } catch {
    return url.startsWith('ws://') || url.startsWith('wss://');
  }
}

