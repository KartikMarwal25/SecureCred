import { describe, it, expect, jest } from '@jest/globals';
import { withRetry } from './retry.js';

describe('withRetry', () => {
  it('returns the result immediately on first success, without waiting or retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and succeeds on a later attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('blip 1'))
      .mockRejectedValueOnce(new Error('blip 2'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error once every attempt is exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('still down'));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow('still down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when shouldRetry returns false, without exhausting all attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('not retryable'));
    const shouldRetry = jest.fn().mockReturnValue(false);
    await expect(withRetry(fn, { attempts: 5, baseDelayMs: 1, shouldRetry })).rejects.toThrow('not retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls onRetry once per failed attempt, with the error and the attempt number', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce('ok');
    const onRetry = jest.fn();
    await withRetry(fn, { attempts: 3, baseDelayMs: 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  it('waits with doubling backoff between attempts', async () => {
    jest.useFakeTimers();
    try {
      const fn = jest.fn().mockRejectedValueOnce(new Error('e1')).mockRejectedValueOnce(new Error('e2')).mockResolvedValueOnce('ok');
      const promise = withRetry(fn, { attempts: 3, baseDelayMs: 100 });

      await Promise.resolve(); // let the first attempt's rejection settle
      expect(fn).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(100); // first backoff
      expect(fn).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(200); // second backoff (doubled)
      expect(fn).toHaveBeenCalledTimes(3);

      await expect(promise).resolves.toBe('ok');
    } finally {
      jest.useRealTimers();
    }
  });
});
