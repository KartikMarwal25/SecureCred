/**
 * `/api/v1/webhooks` — inbound webhooks from third parties. Clerk's webhook
 * needs the untouched raw request body to verify its svix signature, so this
 * route applies `express.raw()` itself and MUST be mounted before the
 * global `express.json()` body parser (see app.js's middleware order).
 */
import { Router, raw } from 'express';
import { ROLE } from '@securecred/shared';

/**
 * Builds the `/api/v1/webhooks` router.
 *
 * @param {object} deps
 * @param {object} deps.clerkAdapter
 * @param {object} deps.userRepo
 * @param {import('pino').Logger} deps.logger
 * @returns {import('express').Router}
 */
export const createWebhooksRouter = ({ clerkAdapter, userRepo, logger }) => {
  const router = Router();

  router.post('/clerk', raw({ type: 'application/json' }), async (req, res) => {
    let payload;
    try {
      payload = clerkAdapter.verifyWebhook(req.body, req.headers);
    } catch (err) {
      logger.warn({ err }, 'webhooks.routes: Clerk webhook signature verification failed');
      res.status(401).json({ status: 'error', message: 'Invalid webhook signature.' });
      return;
    }

    try {
      const { type, data } = payload;
      if (type === 'user.created' || type === 'user.updated') {
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || 'Unknown';
        const email = data.email_addresses?.[0]?.email_address ?? null;
        const metadataRole = data.public_metadata?.role;

        if (metadataRole === ROLE.INSTITUTION) {
          // An institution account is provisioned out-of-band (see
          // db/seeds/seed.js) by explicitly setting public_metadata
          // {role: 'institution', institutionId: '<uuid>'} on the Clerk
          // user first — this is never the default for an unrecognized
          // sign-up, since it grants certificate-issuance privileges.
          const institutionId = data.public_metadata?.institutionId ?? null;
          await userRepo.upsertFromClerk(data.id, fullName, email, ROLE.INSTITUTION, institutionId);
        } else {
          // Everyone else (no metadata role, or explicitly 'student') is
          // self-service and defaults to student — matching the lazy
          // provisioning in auth.mw.js, and using the same email-keyed
          // linking so this webhook and that fallback can't create
          // duplicate rows for the same person.
          await userRepo.provisionOrLinkSelfServiceUser(data.id, email, fullName);
        }
      }
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.error({ err }, 'webhooks.routes: failed to process Clerk webhook (Clerk will retry)');
      res.status(500).json({ status: 'error', message: 'Could not process webhook.' });
    }
  });

  return router;
};
