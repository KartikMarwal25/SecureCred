import { describe, it, expect, jest } from '@jest/globals';
import { backoffDelay, withRetry } from './backoff.js';

describe('backoffDelay', () => {
  it('grows with attempt number (upper bound doubles each time, before the cap)', () => {
    const capMs = 100000; // effectively no cap for this assertion
    // backoffDelay is randomized (full jitter), so assert on the theoretical
    // upper bound (baseMs * 2^attempt) growing, by sampling many draws.
    const sampleMax = (attempt, samples = 500) => {
      let max = 0;
      for (let i = 0; i < samples; i += 1) {
        max = Math.max(max, backoffDelay(attempt, { baseMs: 10, capMs }));
      }
      return max;
    };

    const max0 = sampleMax(0);
    const max3 = sampleMax(3);
    const max6 = sampleMax(6);

    expect(max3).toBeGreaterThan(max0);
    expect(max6).toBeGreaterThan(max3);
  });

  it('never exceeds the configured cap', () => {
    for (let i = 0; i < 500; i += 1) {
      const delay = backoffDelay(10, { baseMs: 100, capMs: 500 });
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(500);
    }
  });

  it('never goes negative even at attempt 0', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(backoffDelay(0, { baseMs: 50, capMs: 1000 })).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseMs: 1, capMs: 2 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient failure');
      return 'recovered';
    });
    const result = await withRetry(fn, { maxAttempts: 5, baseMs: 1, capMs: 2 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { maxAttempts: 4, baseMs: 1, capMs: 2 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('stops early when shouldRetry returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('non-retryable'));
    const shouldRetry = jest.fn().mockReturnValue(false);
    await expect(withRetry(fn, { maxAttempts: 5, baseMs: 1, capMs: 2, shouldRetry })).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
