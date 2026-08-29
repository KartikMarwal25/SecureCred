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
        const roleName = data.public_metadata?.role === ROLE.STUDENT ? ROLE.STUDENT : ROLE.INSTITUTION;
        const institutionId = data.public_metadata?.institutionId ?? null;
        const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || 'Unknown';
        const email = data.email_addresses?.[0]?.email_address ?? null;
        // Idempotent on clerk_user_id — safe for Clerk to retry this webhook.
        await userRepo.upsertFromClerk(data.id, fullName, email, roleName, institutionId);
      }
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      logger.error({ err }, 'webhooks.routes: failed to process Clerk webhook (Clerk will retry)');
      res.status(500).json({ status: 'error', message: 'Could not process webhook.' });
    }
  });

  return router;
};
