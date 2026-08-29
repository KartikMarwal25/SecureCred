/**
 * BEGIN/COMMIT/ROLLBACK wrapper shared by every repository that needs to group
 * multiple statements atomically (e.g. inserting a certificate row and its
 * blockchain_transaction row together). This file may import 'pg' (rule D3).
 */

/**
 * Runs `fn` inside a single database transaction on a dedicated checked-out
 * client. Commits on success, rolls back and rethrows on failure. The client
 * is always released back to the pool.
 *
 * @template T
 * @param {import('pg').Pool} pool - The pg connection pool.
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn - Work to run inside the transaction.
 * @returns {Promise<T>} Whatever `fn` resolves to.
 * @throws {*} Whatever `fn` throws, after the transaction has been rolled back.
 */
export const inTransaction = async (pool, fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback failure — the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
};
