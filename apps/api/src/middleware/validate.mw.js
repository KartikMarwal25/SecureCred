/**
 * Request validation against a zod schema. On failure, responds with the
 * same 400/AppError shape as everything else (field-level errors included).
 */
import { ERROR_CODE } from '@securecred/shared';
import { AppError } from '../lib/errors.js';

/**
 * Builds a middleware that parses `req[source]` against `schema`, replacing
 * it with the parsed (and coerced/defaulted) value on success.
 *
 * @param {import('zod').ZodType} schema
 * @param {'body'|'query'|'params'} [source='body']
 * @returns {import('express').RequestHandler}
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    next(new AppError(ERROR_CODE.E_VALIDATION, 'The request could not be validated.', { fields }));
    return;
  }
  // Express 5 defines `req.query` as a getter-only accessor on some
  // versions; fall back to redefining the property if plain assignment
  // is rejected, rather than silently keeping the unparsed/uncoerced value.
  try {
    req[source] = result.data;
  } catch {
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true, enumerable: true });
  }
  next();
};
