/**
 * Sliding-window rate limiter (in-memory).
 * Tracks timestamps of recent requests within a 60-second window.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs = 60_000;

  constructor(maxRequestsPerMinute: number) {
    this.maxRequests = maxRequestsPerMinute;
  }

  /** Prune timestamps older than 60 seconds */
  private prune(): void {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
  }

  /**
   * Check if a new request is allowed.
   * Does NOT record the request — call record() separately after the check.
   */
  check(): { allowed: boolean; waitSeconds: number } {
    this.prune();
    if (this.timestamps.length >= this.maxRequests) {
      const oldest = this.timestamps[0];
      const waitMs = this.windowMs - (Date.now() - oldest);
      return { allowed: false, waitSeconds: Math.ceil(waitMs / 1000) };
    }
    return { allowed: true, waitSeconds: 0 };
  }

  /** Record that a request was made. Call after check() returns allowed=true. */
  record(): void {
    this.timestamps.push(Date.now());
  }

  /** Stats for /ollama:status display */
  getStats(): { used: number; limit: number; resetsIn: number } {
    this.prune();
    const oldest = this.timestamps[0];
    const resetsIn = oldest
      ? Math.ceil((this.windowMs - (Date.now() - oldest)) / 1000)
      : 0;
    return { used: this.timestamps.length, limit: this.maxRequests, resetsIn };
  }
}
