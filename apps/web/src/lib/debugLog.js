/**
 * The project bans `console.*` from application code (see eslint.config.js,
 * `no-console: error` for apps/web/src). This is the one sanctioned escape
 * hatch: it only writes in dev builds, and it is the single place a
 * `console` call is allowed to live.
 */
export function debugLog(...args) {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.warn('[SecureCred]', ...args);
  }
}
