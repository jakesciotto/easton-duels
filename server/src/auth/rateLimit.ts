export class RateLimiter {
  private failures = new Map<string, number[]>()

  constructor(private readonly max = 5, private readonly windowMs = 60_000) {}

  private recent(key: string, nowMs: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter(t => nowMs - t < this.windowMs)
    this.failures.set(key, kept)
    return kept
  }

  isBlocked(key: string, nowMs = Date.now()): boolean {
    return this.recent(key, nowMs).length >= this.max
  }

  recordFailure(key: string, nowMs = Date.now()): void {
    this.recent(key, nowMs).push(nowMs)
  }
}
