/**
 * The one and only error type this codebase is permitted to throw deliberately
 * (unexpected bugs still surface as native Errors, which error-handler.mw.js
 * maps to E_INTERNAL). Never construct a bare Error/string for a domain failure.
 */
import { ERROR_STATUS, ERROR_CODE } from '@securecred/shared';

export class AppError extends Error {
  /**
   * @param {string} code - One of @securecred/shared's ERROR_CODE values.
   * @param {string} message - Human-readable message. May cross the wire, so it
   *   must never embed secrets, stack traces, or internal identifiers.
   * @param {object} [options]
   * @param {number} [options.status] - HTTP status override (defaults to ERROR_STATUS[code] or 500).
   * @param {unknown} [options.cause] - The underlying error/reason. Server-side only, never sent to clients.
   * @param {object} [options.context] - Extra debugging context. Server-side only, never sent to clients.
   * @param {Array<{path:string, message:string}>} [options.fields] - Field-level validation errors, safe to send.
   * @param {object} [options.publicMeta] - Extra structured data that IS safe to send to the client (e.g. a
   *   certificateId to keep navigating to, for a "created but still retrying" outcome) — unlike `context`,
   *   which is server-side only. Deliberately a separate field from `context` rather than a flag on it, so
   *   the "never sent to clients" invariant on `context` itself is never conditional on remembering to check
   *   a flag before including it.
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code] ?? 500;
    this.cause = options.cause;
    this.context = options.context;
    this.fields = options.fields;
    this.publicMeta = options.publicMeta;
    Error.captureStackTrace?.(this, AppError);
  }
}

/**
 * Converts any thrown error into the exact, minimal shape allowed across the
 * wire: `{status:'error', code, message, fields?, meta?, correlationId}`.
 * Never includes `cause`, `context`, or a stack trace — those stay
 * server-side. `meta` (from `publicMeta`) is nested, never spread, so it can
 * never collide with this shape's own reserved keys.
 *
 * @param {unknown} err - The caught error (AppError or otherwise).
 * @param {string} correlationId - The request's correlation id (req.id).
 * @returns {{status:'error', code:string, message:string, fields?:Array, meta?:object, correlationId:string}}
 */
export const toWire = (err, correlationId) => {
  if (err instanceof AppError) {
    const wire = {
      status: 'error',
      code: err.code,
      message: err.message,
      correlationId,
    };
    if (err.fields) wire.fields = err.fields;
    if (err.publicMeta) wire.meta = err.publicMeta;
    return wire;
  }
  return {
    status: 'error',
    code: ERROR_CODE.E_INTERNAL,
    message: 'An unexpected error occurred.',
    correlationId,
  };
};
