/**
 * Raw parameterized SQL for `worker_cursor` — tracks the last-processed chain
 * block per event stream so the worker's event listener can replay from where
 * it left off after a restart. Lives under apps/api/repositories/ (per spec)
 * because only repositories/ may import 'pg' (rule D3); the worker imports
 * this module via a relative path. Only repositories/ may import 'pg'.
 */

/**
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @returns {object} Frozen repository object.
 */
export const createWorkerCursorRepo = ({ pool }) => {
  const exec = (client) => client ?? pool;

  /**
   * @param {string} cursorKey - e.g. 'chain-events:local'.
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<bigint|null>} The stored cursor value, or null if never set.
   */
  const get = async (cursorKey, client) => {
    const { rows } = await exec(client).query(
      `SELECT cursor_value FROM worker_cursor WHERE cursor_key = $1`,
      [cursorKey],
    );
    return rows[0] ? Number(rows[0].cursor_value) : null;
  };

  /**
   * Upserts the cursor's new value.
   *
   * @param {string} cursorKey
   * @param {number|bigint} value
   * @param {import('pg').PoolClient} [client]
   * @returns {Promise<void>}
   */
  const set = async (cursorKey, value, client) => {
    await exec(client).query(
      `INSERT INTO worker_cursor (cursor_key, cursor_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (cursor_key) DO UPDATE SET cursor_value = EXCLUDED.cursor_value, updated_at = now()`,
      [cursorKey, value],
    );
  };

  return Object.freeze({ get, set });
};
