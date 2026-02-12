type Listener = (...args: unknown[]) => void;

export class EventBus {
  private listeners: Map<string, Set<Listener>> = new Map();
  private onceListeners: Map<string, Set<Listener>> = new Map();

  on(event: string, listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  once(event: string, listener: Listener): void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(listener);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
    this.onceListeners.get(event)?.delete(listener);
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  emit(event: string, ...args: unknown[]): void {
    const ls = this.listeners.get(event);
    if (ls) {
      for (const l of ls) {
        try {
          l(...args);
        } catch (err) {
          console.error(`[eventBus] listener error on ${event}`, err);
        }
      }
    }
    // Handle once listeners
    const onceLs = this.onceListeners.get(event);
    if (onceLs && onceLs.size > 0) {
      const toCall = [...onceLs];
      onceLs.clear();
      for (const l of toCall) {
        try {
          l(...args);
        } catch (err) {
          console.error(`[eventBus] once listener error on ${event}`, err);
        }
      }
    }
  }

  listenerCount(event: string): number {
    const regular = this.listeners.get(event)?.size ?? 0;
    const once = this.onceListeners.get(event)?.size ?? 0;
    return regular + once;
  }
}
