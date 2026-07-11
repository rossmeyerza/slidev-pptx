export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    if (recent.length >= this.max) {
      this.prune(now);
      return false;
    }
    recent.push(now);
    this.attempts.set(key, recent);
    this.prune(now);
    return true;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.attempts) {
      const recent = timestamps.filter((timestamp) => timestamp > cutoff);
      if (recent.length) this.attempts.set(key, recent);
      else this.attempts.delete(key);
    }
  }
}
