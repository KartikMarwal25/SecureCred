/**
 * `/api/v1/certificates` — issuance, listing, detail, status polling,
 * revocation, public verification, and public document retrieval.
 */
import { Router, raw } from 'express';
import {
  ROLE,
  CERT_STATE,
  TRANSACTION_TYPE,
  VERIFY_OUTCOME,
  VERIFICATION_METHOD,
  ERROR_CODE,
  issuanceRequestSchema,
  revocationRequestSchema,
  certificateListQuerySchema,
  certificateIdParamSchema,
  certificateNumberParamSchema,
  batchIssuanceRequestSchema,
  batchJobIdParamSchema,
} from '@securecred/shared';
import { validate } from '../middleware/validate.mw.js';
import { requireRole } from '../middleware/rbac.mw.js';
import { AppError } from '../lib/errors.js';

/** Shapes a full row for an institution/owning-student detail view. */
const toDetailView = (cert) => ({
  certificateId: cert.certificate_id,
  certificateNumber: cert.certificate_number,
  title: cert.title,
  certificateType: cert.certificate_type,
  issueDate: cert.issue_date,
  attributes: cert.attributes,
  status: cert.status,
  certificateHash: cert.certificate_hash,
  institutionId: cert.institution_id,
  studentId: cert.student_id,
  holderName: cert.holder_name ?? null,
  holderEmail: cert.holder_email ?? null,
  createdAt: cert.created_at,
  updatedAt: cert.updated_at,
});

/**
 * Expands `toDetailView` with the extra fields only `findDetailById` fetches
 * (institution name, issuing staff member, IPFS reference, transaction/block
 * evidence, and the revocation record) — used by the single-certificate
 * detail route only, not by the list/status routes.
 */
const toFullDetailView = (cert) => ({
  ...toDetailView(cert),
  institutionName: cert.institution_name ?? null,
  issuedBy: cert.issued_by_name ?? null,
  ipfsCid: cert.ipfs_cid ?? null,
  txHash: cert.issue_tx_hash ?? null,
  blockNumber: cert.issue_block_number ?? null,
  revocation: cert.revocation_reason
    ? {
        reason: cert.revocation_reason,
        revokedAt: cert.revocation_revoked_at,
        revokedBy: cert.revoked_by_name ?? null,
        txHash: cert.revoke_tx_hash ?? null,
      }
    : null,
});

/** Shapes the public-safe projection returned by the anonymous verify/document endpoints. */
const toPublicView = (cert) => ({
  certificateNumber: cert.certificate_number,
  title: cert.title,
  certificateType: cert.certificate_type,
  issueDate: cert.issue_date,
  status: cert.status,
  holderName: cert.holder_name,
  institutionName: cert.institution_name,
});

/**
 * Builds the `/api/v1/certificates` router.
 *
 * @param {object} deps
 * @param {object} deps.issuanceService
 * @param {object} deps.verificationService
 * @param {object} deps.revocationService
 * @param {object} deps.batchIssuanceService
 * @param {object} deps.certificateRepo
 * @param {object} deps.fileRepo
 * @param {object} deps.txRepo
 * @param {object} deps.pinataAdapter
 * @param {import('express').RequestHandler} deps.requireAuth
 * @param {import('express').RequestHandler} deps.issuanceLimiter
 * @param {import('express').RequestHandler} deps.revocationLimiter
 * @param {import('express').RequestHandler} deps.verifyMinuteLimiter
 * @param {import('express').RequestHandler} deps.verifyHourLimiter
 * @param {object} deps.config
 * @returns {import('express').Router}
 */
export const createCertificatesRouter = ({
  issuanceService,
  verificationService,
  revocationService,
  batchIssuanceService,
  certificateRepo,
  fileRepo,
  txRepo,
  pinataAdapter,
  requireAuth,
  issuanceLimiter,
  revocationLimiter,
  verifyMinuteLimiter,
  verifyHourLimiter,
  config,
}) => {
  const router = Router();

  router.post(
    '/',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    issuanceLimiter,
    validate(issuanceRequestSchema, 'body'),
    async (req, res, next) => {
      try {
        const result = await issuanceService.issue(req.body, {
          userId: req.auth.userId,
          institutionId: req.auth.institutionId,
        });
        // Flat response body (status:'ok' plus the fields directly) — matches
        // the convention used by every other endpoint in this router (list,
        // verify) so the web client can read fields off the root consistently.
        res.status(202).json({ status: 'ok', ...result });
      } catch (err) {
        next(err);
      }
    },
  );

  // Registered before GET /:id so "batch" is never mistaken for a
  // certificate id (certificateIdParamSchema would reject it as a non-UUID
  // anyway, but a more specific route matching first is the clearer intent).
  router.post(
    '/batch',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    issuanceLimiter,
    validate(batchIssuanceRequestSchema, 'body'),
    async (req, res, next) => {
      try {
        const result = await batchIssuanceService.createBatch(req.body.csvContent, {
          userId: req.auth.userId,
          institutionId: req.auth.institutionId,
        });
        res.status(202).json({ status: 'ok', ...result });
      } catch (err) {
        // parseCsv/createBatch throw plain Errors for malformed input
        // (empty file, wrong column count, missing required column, over
        // the row cap) — surfaced as a validation error, not a 500.
        next(new AppError(ERROR_CODE.E_VALIDATION, err.message));
      }
    },
  );

  router.get(
    '/batch/:batchJobId',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    validate(batchJobIdParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const result = await batchIssuanceService.getBatchStatus(req.params.batchJobId);
        if (!result || result.job.institution_id !== req.auth.institutionId) {
          throw new AppError(ERROR_CODE.E_NOT_FOUND, 'Batch job not found.');
        }
        res.status(200).json({
          status: 'ok',
          batchJobId: result.job.batch_job_id,
          jobStatus: result.job.status,
          totalRows: result.job.total_rows,
          processedRows: result.job.processed_rows,
          succeededRows: result.job.succeeded_rows,
          failedRows: result.job.failed_rows,
          createdAt: result.job.created_at,
          completedAt: result.job.completed_at,
          rows: result.rows.map((r) => ({
            rowNumber: r.row_number,
            status: r.status,
            certificateId: r.certificate_id,
            errorMessage: r.error_message,
          })),
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    validate(certificateListQuerySchema, 'query'),
    async (req, res, next) => {
      try {
        const { items, nextCursor } = await certificateRepo.listByInstitution({
          institutionId: req.auth.institutionId,
          cursor: req.query.cursor,
          limit: req.query.limit,
          status: req.query.status,
          q: req.query.q,
          from: req.query.from,
          to: req.query.to,
        });
        res.status(200).json({ status: 'ok', items: items.map(toDetailView), nextCursor });
      } catch (err) {
        next(err);
      }
    },
  );

  // A 403 here must look identical whether the certificate doesn't exist at
  // all or simply belongs to someone else — the scope check happens before
  // any existence-based branching (no enumeration oracle).
  router.get('/:id', requireAuth, validate(certificateIdParamSchema, 'params'), async (req, res, next) => {
    try {
      const cert = await certificateRepo.findDetailById(req.params.id);
      const authorized =
        Boolean(cert) &&
        ((req.auth.role === ROLE.INSTITUTION && cert.institution_id === req.auth.institutionId) ||
          (req.auth.role === ROLE.STUDENT && Boolean(req.auth.studentId) && cert.student_id === req.auth.studentId));

      if (!authorized) {
        throw new AppError(ERROR_CODE.E_FORBIDDEN, 'You do not have permission to view this certificate.');
      }

      res.status(200).json({ status: 'ok', ...toFullDetailView(cert) });
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/:id/status',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    validate(certificateIdParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const cert = await certificateRepo.findById(req.params.id);
        if (!cert || cert.institution_id !== req.auth.institutionId) {
          throw new AppError(ERROR_CODE.E_FORBIDDEN, 'You do not have permission to view this certificate.');
        }

        const isRevocationSide = cert.status === CERT_STATE.REVOKING || cert.status === CERT_STATE.REVOKED;
        const tx = await txRepo.findLatestForCertificate(
          cert.certificate_id,
          isRevocationSide ? TRANSACTION_TYPE.REVOKE : TRANSACTION_TYPE.ISSUE,
        );

        res.set('Cache-Control', 'private, max-age=2');
        res.status(200).json({
          status: 'ok',
          state: cert.status,
          txHash: tx?.transaction_hash ?? null,
          confirmations: tx?.confirmations ?? 0,
          requiredConfirmations: config.confirmationDepth,
          updatedAt: cert.updated_at,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/revoke/:certificateNumber',
    requireAuth,
    requireRole(ROLE.INSTITUTION),
    revocationLimiter,
    validate(certificateNumberParamSchema, 'params'),
    validate(revocationRequestSchema, 'body'),
    async (req, res, next) => {
      try {
        const result = await revocationService.revoke(req.params.certificateNumber, req.body.reason, {
          userId: req.auth.userId,
          institutionId: req.auth.institutionId,
        });
        res.status(202).json({ status: 'ok', ...result });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/verify/:certificateNumber',
    verifyMinuteLimiter,
    verifyHourLimiter,
    validate(certificateNumberParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const result = await verificationService.verify(req.params.certificateNumber, VERIFICATION_METHOD.CERT_ID, null);

        const isPublic = result.outcome === VERIFY_OUTCOME.VERIFIED || result.outcome === VERIFY_OUTCOME.REVOKED;
        const body = {
          status: 'ok',
          outcome: result.outcome,
          degraded: result.degraded,
          certificate: isPublic ? toPublicView(result.certificate) : null,
          revocationReason: result.outcome === VERIFY_OUTCOME.REVOKED ? result.revocationReason : null,
          lastConfirmedAt: result.lastConfirmedAt,
          // "Blockchain Proof" evidence — only meaningful (and only ever
          // populated by the service) for a favorable outcome.
          certificateHash: isPublic ? result.certificateHash : null,
          ipfsCid: isPublic ? result.ipfsCid : null,
          txHash: isPublic ? result.txHash : null,
        };

        const statusCode =
          result.outcome === VERIFY_OUTCOME.NOT_FOUND ? 404 : result.outcome === VERIFY_OUTCOME.TAMPERED ? 400 : 200;
        res.status(statusCode).json(body);
      } catch (err) {
        next(err);
      }
    },
  );

  // Upload-based verification: the verifier supplies their own copy of the
  // document instead of relying on the IPFS-served copy. This is the only
  // check that can actually catch a document a verifier altered themselves
  // — see the module-level note in verificationService.js for why the
  // IPFS-refetch path (used by /verify above) structurally cannot.
  // `raw()` only consumes requests whose Content-Type is application/pdf, so
  // it coexists safely with the global express.json() body parser without
  // needing to be pre-mounted in app.js (unlike webhooks/batch, which are
  // also application/json and would otherwise race the global parser).
  router.post(
    '/verify-upload/:certificateNumber',
    verifyMinuteLimiter,
    verifyHourLimiter,
    validate(certificateNumberParamSchema, 'params'),
    raw({ type: 'application/pdf', limit: '10mb' }),
    async (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
          throw new AppError(
            ERROR_CODE.E_VALIDATION,
            'Upload a PDF document to verify (Content-Type: application/pdf).',
          );
        }

        const result = await verificationService.verify(
          req.params.certificateNumber,
          VERIFICATION_METHOD.HASH,
          null,
          req.body,
        );

        const isPublic = result.outcome === VERIFY_OUTCOME.VERIFIED || result.outcome === VERIFY_OUTCOME.REVOKED;
        const body = {
          status: 'ok',
          outcome: result.outcome,
          degraded: result.degraded,
          certificate: isPublic ? toPublicView(result.certificate) : null,
          revocationReason: result.outcome === VERIFY_OUTCOME.REVOKED ? result.revocationReason : null,
          lastConfirmedAt: result.lastConfirmedAt,
          certificateHash: isPublic ? result.certificateHash : null,
          ipfsCid: isPublic ? result.ipfsCid : null,
          txHash: isPublic ? result.txHash : null,
        };

        const statusCode =
          result.outcome === VERIFY_OUTCOME.NOT_FOUND ? 404 : result.outcome === VERIFY_OUTCOME.TAMPERED ? 400 : 200;
        res.status(statusCode).json(body);
      } catch (err) {
        next(err);
      }
    },
  );

  // Shares /verify's rate limiters — this does everything /verify does
  // (the same verificationService.verify() lookup) plus a real external
  // Pinata fetch on top, so it's strictly more expensive per request, not
  // less; it had no rate limiting at all before this, unlike its sibling.
  router.get(
    '/:certificateNumber/document',
    verifyMinuteLimiter,
    verifyHourLimiter,
    validate(certificateNumberParamSchema, 'params'),
    async (req, res, next) => {
      try {
        const result = await verificationService.verify(req.params.certificateNumber, VERIFICATION_METHOD.CERT_ID, null);

        if (result.outcome !== VERIFY_OUTCOME.VERIFIED && result.outcome !== VERIFY_OUTCOME.REVOKED) {
          throw new AppError(ERROR_CODE.E_FORBIDDEN, 'This document cannot be verified.');
        }

        const files = await fileRepo.findByCertificateId(result.certificate.certificate_id);
        const latestFile = files[files.length - 1];
        if (!latestFile) {
          throw new AppError(ERROR_CODE.E_FORBIDDEN, 'This document cannot be verified.');
        }

        const buffer = await pinataAdapter.fetchByCid(latestFile.ipfs_cid);
        res.set('Content-Type', 'application/pdf');
        res.status(200).send(buffer);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
};
