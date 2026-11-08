const REMEMBER_MS = 2 * 60 * 1000;
const MAX_REMEMBERED = 512;

/** Tracks cancellation even when it arrives before a request handler starts. */
export class Requests {
  private readonly active = new Map<string, AbortController>();
  private readonly cancelled = new Map<string, number>();
  private readonly finished = new Map<string, number>();
  private saturatedUntil = 0;

  private prune(now: number): void {
    for (const records of [this.cancelled, this.finished]) {
      for (const [id, expires] of records) if (expires <= now) records.delete(id);
    }
  }

  begin(id: string): AbortController | null {
    const now = Date.now();
    this.prune(now);
    if (this.active.has(id) || this.finished.has(id) || this.saturatedUntil > now) return null;
    const controller = new AbortController();
    if (this.cancelled.delete(id)) controller.abort();
    this.active.set(id, controller);
    return controller;
  }

  cancel(id: string): boolean {
    const now = Date.now();
    this.prune(now);
    const controller = this.active.get(id);
    if (controller) {
      controller.abort();
      return true;
    }
    if (this.finished.has(id)) return false;
    if (this.cancelled.size >= MAX_REMEMBERED && !this.cancelled.has(id)) {
      // Fail closed while cancellation records cannot be kept safely.
      this.saturatedUntil = now + REMEMBER_MS;
      return true;
    }
    this.cancelled.set(id, now + REMEMBER_MS);
    return true;
  }

  finish(id: string, controller: AbortController): void {
    if (this.active.get(id) !== controller) return;
    this.active.delete(id);
    if (this.finished.size >= MAX_REMEMBERED) {
      const oldest = this.finished.keys().next().value;
      if (oldest !== undefined) this.finished.delete(oldest);
    }
    this.finished.set(id, Date.now() + REMEMBER_MS);
  }

  stop(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    this.cancelled.clear();
    this.finished.clear();
  }
}
