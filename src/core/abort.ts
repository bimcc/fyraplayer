/** Observe cancellation without leaving late promise rejections unhandled. */
export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Loading cancelled', 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** Use only where late work cannot acquire resources after cancellation. */
export function waitWithSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    work.then(value => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(abortReason(signal));
      else resolve(value);
    }, error => {
      signal.removeEventListener('abort', cancel);
      reject(error);
    });
  });
}

/** A child scope can timeout independently without cancelling later fallback attempts. */
export function createLoadScope(parent?: AbortSignal, timeoutMs = 0) {
  const controller = new AbortController();
  const cancel = () => controller.abort(parent && abortReason(parent));
  parent?.addEventListener('abort', cancel, { once: true });
  if (parent?.aborted) cancel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (!controller.signal.aborted && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(new DOMException(`Load timed out after ${timeoutMs}ms`, 'TimeoutError')), timeoutMs);
  }
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener('abort', cancel);
    }
  };
}
