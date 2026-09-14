/**
 * Identity verification via Clerk. `verifyToken` decodes and cryptographically
 * verifies a bearer session token; `verifyWebhook` verifies a Clerk webhook's
 * svix signature over the raw request body. Both fall back to an unsigned
 * DEV MODE when their respective secret is unset, so the whole stack can run
 * locally without a real Clerk account — the real path is still fully
 * implemented for when real keys are supplied.
 */
import { verifyToken as clerkVerifyToken, createClerkClient } from '@clerk/backend';
import { Webhook } from 'svix';
import { AppError } from '../lib/errors.js';
import { ERROR_CODE, ROLE } from '@securecred/shared';

let devAuthWarningLogged = false;
const warnDevAuth = (logger) => {
  if (!devAuthWarningLogged) {
    devAuthWarningLogged = true;
    logger.warn(
      '[clerk.adapter] CLERK_SECRET_KEY not set -- using DEV AUTH BYPASS, tokens are NOT verified. Do not use in production.',
    );
  }
};

/**
 * `dev:<role>:<institutionId-or-empty>:<userAccountId>:<email>:<studentProfileId-or-empty>`
 *
 * `userAccountId` must be a real `user_account.user_id` (it's used verbatim
 * for every FK that records "who did this", e.g. `certificate.issued_by`).
 * `studentProfileId`, when present, must be the matching `student.student_id`
 * — a DIFFERENT id from `user_account.user_id` in this schema (one student
 * row per user, joined by `student.user_id`) — since certificate scope checks
 * compare against `certificate.student_id`, not the user id. The trailing
 * segment is optional so an institution actor's token can omit it.
 */
const DEV_TOKEN_PATTERN = /^dev:([^:]+):([^:]*):([^:]*):([^:]+)(?::([^:]*))?$/;

/**
 * Creates the Clerk identity adapter.
 *
 * @param {object} deps
 * @param {object} deps.config - Frozen app config (uses clerkSecretKey, clerkWebhookSecret).
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen adapter: `{ verifyToken, verifyWebhook }`.
 */
export const createClerkAdapter = ({ config, logger }) => {
  // Only constructed if actually needed (see the email/fullName fallback in
  // verifyToken below) — most requests never touch this.
  let backendClient = null;
  const getBackendClient = () => {
    if (!backendClient) {
      backendClient = createClerkClient({ secretKey: config.clerkSecretKey });
    }
    return backendClient;
  };

  /**
   * Verifies a bearer token and returns its decoded claims. In dev-bypass
   * mode (no CLERK_SECRET_KEY), accepts the unsigned `dev:...` token shape
   * instead of a real JWT.
   *
   * @param {string} bearerToken - Raw token, without the `Bearer ` prefix.
   * @returns {Promise<{userId: string, role: string, institutionId: string|null, studentId: string|null, email: string|null, fullName: string|null}>}
   * @throws {AppError} E_UNAUTHENTICATED if the token is missing/invalid, E_TOKEN_EXPIRED if expired.
   */
  const verifyToken = async (bearerToken) => {
    if (!bearerToken) {
      throw new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Sign in to continue.');
    }

    if (!config.clerkSecretKey) {
      warnDevAuth(logger);
      const match = DEV_TOKEN_PATTERN.exec(bearerToken);
      if (!match) {
        throw new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Malformed dev token.');
      }
      const [, role, institutionId, userAccountId, email, studentProfileId] = match;
      if (!Object.values(ROLE).includes(role)) {
        throw new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Unknown dev role.');
      }
      return {
        userId: userAccountId || 'dev-user',
        role,
        institutionId: institutionId || null,
        studentId: role === ROLE.STUDENT ? studentProfileId || null : null,
        email: email || null,
        fullName: email || null,
      };
    }

    try {
      // clockSkewInMs: @clerk/backend defaults to 5s tolerance on the
      // exp/nbf/iat claims, which is too tight for a container clock behind
      // a host VM (WSL2's clock has observed jitter of 10-15s in this
      // environment, independent of any drift-correction — see docs/
      // CLERK_SETUP.md). 30s costs nothing security-wise (these are
      // short-lived session tokens anyway) and makes verification robust
      // against VM clock jitter instead of depending on it never happening.
      const claims = await clerkVerifyToken(bearerToken, {
        secretKey: config.clerkSecretKey,
        clockSkewInMs: 30_000,
      });

      // `claims.email`/`claims.fullName` only exist if the Clerk Dashboard's
      // "Customize session token" step (docs/CLERK_SETUP.md §5) was
      // actually applied — if it wasn't (or was saved with a typo), these
      // come back undefined, which would otherwise insert a NULL into
      // user_account.email (NOT NULL) and 500 the whole request. Falling
      // back to a direct Backend API call makes this correct regardless of
      // whether that dashboard step was done, at the cost of one extra HTTP
      // call, only on tokens missing the custom claim.
      let email = claims.email ?? null;
      let fullName = claims.fullName ?? null;
      if (!email) {
        try {
          const user = await getBackendClient().users.getUser(claims.sub);
          email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses?.[0]?.emailAddress ?? null;
          fullName = fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || null;
        } catch (fetchErr) {
          logger.warn({ err: fetchErr, userId: claims.sub }, '[clerk.adapter] could not fetch user profile as an email fallback');
        }
      }

      return {
        userId: claims.sub,
        // `role`/`institutionId` are read here only as a fallback for an
        // institution account (provisioned out-of-band, its role/institution
        // set once via Clerk metadata) — for everyone else the database is
        // authoritative (see auth.mw.js), since a self-registered student's
        // scope can change (e.g. once an institution issues them something)
        // without their session token ever being reissued.
        role: claims.role ?? null,
        institutionId: claims.institutionId ?? null,
        studentId: claims.studentId ?? null,
        email,
        fullName,
      };
    } catch (err) {
      const message = String(err?.message ?? '');
      if (/expired/i.test(message)) {
        throw new AppError(ERROR_CODE.E_TOKEN_EXPIRED, 'Your session has expired. Please sign in again.', { cause: err });
      }
      throw new AppError(ERROR_CODE.E_UNAUTHENTICATED, 'Sign in to continue.', { cause: err });
    }
  };

  /**
   * Verifies a Clerk webhook's svix signature over the raw request body.
   * Must be called with the untouched raw bytes (before any JSON parsing).
   *
   * @param {Buffer|string} rawBody
   * @param {Record<string, string>} headers - Must include svix-id/svix-timestamp/svix-signature.
   * @returns {object} The verified, parsed webhook payload.
   * @throws {AppError} E_WEBHOOK_SIGNATURE if verification fails.
   */
  const verifyWebhook = (rawBody, headers) => {
    if (!config.clerkWebhookSecret) {
      warnDevAuth(logger);
      try {
        return JSON.parse(rawBody.toString('utf8'));
      } catch (err) {
        throw new AppError(ERROR_CODE.E_WEBHOOK_SIGNATURE, 'Malformed webhook payload.', { cause: err });
      }
    }

    try {
      const webhook = new Webhook(config.clerkWebhookSecret);
      return webhook.verify(rawBody, {
        'svix-id': headers['svix-id'],
        'svix-timestamp': headers['svix-timestamp'],
        'svix-signature': headers['svix-signature'],
      });
    } catch (err) {
      throw new AppError(ERROR_CODE.E_WEBHOOK_SIGNATURE, 'Webhook signature verification failed.', { cause: err });
    }
  };

  return Object.freeze({ verifyToken, verifyWebhook });
};
