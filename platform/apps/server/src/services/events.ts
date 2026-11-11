type Handler = (data: unknown) => void;

/** In-process pub/sub bridged to WebSocket clients and SSE streams. */
export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on(topic: string, handler: Handler): () => void {
    const set = this.handlers.get(topic) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(topic, set);
    return () => set.delete(handler);
  }

  emit(topic: string, data: unknown): void {
    const set = this.handlers.get(topic);
    if (!set) return;
    for (const h of set) {
      try {
        h(data);
      } catch {
        /* a broken listener must not break the emitter */
      }
    }
  }
}
