import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rateLimiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows first request', () => {
    const limiter = new RateLimiter(5);
    const result = limiter.check();
    expect(result.allowed).toBe(true);
    expect(result.waitSeconds).toBe(0);
  });

  it('allows requests up to limit', () => {
    const limiter = new RateLimiter(3);
    limiter.record();
    limiter.record();
    const result = limiter.check();
    expect(result.allowed).toBe(true);
  });

  it('blocks when limit is reached', () => {
    const limiter = new RateLimiter(3);
    limiter.record();
    limiter.record();
    limiter.record();
    const result = limiter.check();
    expect(result.allowed).toBe(false);
    expect(result.waitSeconds).toBeGreaterThan(0);
  });

  it('allows requests again after window expires', () => {
    const limiter = new RateLimiter(2);
    limiter.record();
    limiter.record();
    expect(limiter.check().allowed).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(limiter.check().allowed).toBe(true);
  });

  it('getStats returns used count and limit', () => {
    const limiter = new RateLimiter(10);
    limiter.record();
    limiter.record();
    const stats = limiter.getStats();
    expect(stats.used).toBe(2);
    expect(stats.limit).toBe(10);
  });
});
