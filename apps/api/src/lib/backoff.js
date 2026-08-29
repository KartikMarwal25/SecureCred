/**
 * Generic exponential-backoff-with-jitter helpers used by any adapter that
 * talks to a flaky external system (Pinata, RPC node, etc).
 */

/**
 * Computes the delay (ms) to wait before retry attempt `attempt`, using full
 * jitter: a random value between 0 and `min(cap, base * 2^attempt)`.
 *
 * @param {number} attempt - Zero-based attempt number (0 = first retry).
 * @param {object} [opts]
 * @param {number} [opts.baseMs=100] - Base delay in ms.
 * @param {number} [opts.capMs=5000] - Maximum delay in ms.
 * @returns {number} Delay in milliseconds, `0 <= delay <= capMs`.
 */
export const backoffDelay = (attempt, opts = {}) => {
  const baseMs = opts.baseMs ?? 100;
  const capMs = opts.capMs ?? 5000;
  const exponential = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exponential);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` and retries it with exponential backoff + jitter on failure.
 *
 * @template T
 * @param {() => Promise<T>} fn - The operation to run. Receives no arguments.
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3] - Total attempts (including the first), minimum 1.
 * @param {number} [opts.baseMs=100] - Base delay in ms, forwarded to backoffDelay.
 * @param {number} [opts.capMs=5000] - Max delay in ms, forwarded to backoffDelay.
 * @param {(err: unknown, attempt: number) => boolean} [opts.shouldRetry] - Predicate; return false to stop retrying early. Defaults to always retry.
 * @param {(delay: number, attempt: number, err: unknown) => void} [opts.onRetry] - Optional callback invoked before each sleep, useful for logging.
 * @returns {Promise<T>} The resolved value of `fn`.
 * @throws {*} The last error thrown by `fn`, once attempts are exhausted or `shouldRetry` returns false.
 */
export const withRetry = async (fn, opts = {}) => {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const shouldRetry = opts.shouldRetry ?? (() => true);
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential retries are inherently dependent, not independent iterations
      return await fn();
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delay = backoffDelay(attempt, opts);
      opts.onRetry?.(delay, attempt, err);
      // eslint-disable-next-line no-await-in-loop -- must wait between sequential retries of the same operation
      await sleep(delay);
    }
  }
  throw lastError;
};
