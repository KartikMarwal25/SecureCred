/**
 * Generic retry-with-backoff for a transient external-dependency failure
 * (Pinata/IPFS, the chain RPC) inside a single call — absorbs a blip lasting
 * a few seconds to tens of seconds without needing the worker's reconciler
 * at all. Doubles the delay after each attempt (simple exponential backoff,
 * no jitter — the caller count here is low enough that a thundering herd
 * isn't a real risk).
 */

/**
 * @param {() => Promise<T>} fn - Retried as-is; must be safe to call again
 *   on failure (idempotent, or at least not harmful to repeat).
 * @param {object} [options]
 * @param {number} [options.attempts] - Total attempts, including the first (not additional retries).
 * @param {number} [options.baseDelayMs] - Delay before the second attempt; doubles each attempt after.
 * @param {(err: unknown) => boolean} [options.shouldRetry] - Return false to stop retrying and rethrow immediately.
 * @param {(err: unknown, attempt: number) => void} [options.onRetry] - Called after a failed attempt, before the delay.
 * @returns {Promise<T>}
 * @template T
 */
export const withRetry = async (fn, options = {}) => {
  const { attempts = 3, baseDelayMs = 1000, shouldRetry = () => true, onRetry } = options;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      // Attempts are sequential retries of the SAME operation, not
      // independent iterations — each depends on the previous one's failure.
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === attempts || !shouldRetry(err)) throw err;
      onRetry?.(err, attempt);
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
};
