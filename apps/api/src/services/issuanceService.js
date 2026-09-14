/**
 * Certificate issuance pipeline (FR-ISS-001..* · BR "persist-before-external-
 * call": we never call an external system — Pinata, the chain — before the
 * corresponding DB row already exists, so a crash mid-pipeline always leaves
 * a resumable/inspectable record rather than an orphaned external side effect).
 */
import { CERT_STATE, ERROR_CODE, TRANSACTION_TYPE } from '@securecred/shared';
import { AppError } from '../lib/errors.js';
import { withRetry } from '../lib/retry.js';

const MAX_CERT_NUMBER_ATTEMPTS = 5;

// Bounded, short in-request retries for the two external calls in this
// pipeline (Pinata pin, chain anchor) — absorbs a blip lasting a few
// seconds to tens of seconds without needing the worker's reconciler at
// all. Deliberately short: this blocks the HTTP request (or one batch row),
// so it must give up quickly and hand off to the reconciler for anything
// longer, not hang the caller indefinitely.
const EXTERNAL_CALL_RETRY_OPTIONS = { attempts: 3, baseDelayMs: 2000 };

/**
 * @param {unknown} err
 * @param {string} columnSubstring
 * @returns {boolean} True if `err` looks like a Postgres unique-violation on a constraint involving `columnSubstring`.
 */
const isUniqueViolationOn = (err, columnSubstring) =>
  err?.code === '23505' &&
  (String(err.constraint ?? '').includes(columnSubstring) || String(err.detail ?? '').includes(columnSubstring));

/**
 * Creates the issuance service.
 *
 * @param {object} deps
 * @param {object} deps.certificateRepo
 * @param {object} deps.fileRepo
 * @param {object} deps.txRepo
 * @param {object} deps.userRepo
 * @param {object} deps.institutionRepo - Resolves institution code/name for cert numbering and the PDF header.
 * @param {object} deps.pdfAdapter
 * @param {object} deps.pinataAdapter
 * @param {object} deps.chainAdapter
 * @param {object} deps.hashLib - lib/hash.js's exports (injected for testability).
 * @param {object} deps.certIdLib - lib/certId.js's exports (injected for testability).
 * @param {object} deps.qrLib - The `qrcode` package (or a substitute exposing `toBuffer`).
 * @param {object} deps.lifecycleService - The only permitted caller of certificateRepo.updateStatus (via transition()).
 * @param {object} deps.auditRepo
 * @param {object} deps.config - Frozen app config (uses verifyBaseUrl, chainNetwork, contractAddress).
 * @param {import('pino').Logger} deps.logger
 * @param {(fn: (client: import('pg').PoolClient) => Promise<*>) => Promise<*>} deps.withTransaction
 * @returns {object} Frozen service: `{ issue }`.
 */
export const createIssuanceService = ({
  certificateRepo,
  fileRepo,
  txRepo,
  userRepo,
  institutionRepo,
  pdfAdapter,
  pinataAdapter,
  chainAdapter,
  hashLib,
  certIdLib,
  qrLib,
  lifecycleService,
  auditRepo,
  config,
  logger,
  withTransaction,
}) => {
  /**
   * Issues a new certificate. Returns as soon as the anchor transaction has
   * been broadcast (status ANCHORING) — confirmation is the worker's job.
   *
   * @param {object} input - Already validated against issuanceRequestSchema at the route layer.
   * @param {string} input.holderName
   * @param {string} input.holderEmail
   * @param {string} input.enrollmentNumber
   * @param {string} input.title
   * @param {string} input.certificateType
   * @param {string} input.course
   * @param {string} [input.gradeOrResult]
   * @param {string} input.issueDate - ISO date string.
   * @param {object} [input.attributes]
   * @param {{userId: string, institutionId: string}} actor
   * @returns {Promise<{certificateId: string, certificateNumber: string, status: string, txHash: string, verifyUrl: string}>}
   * @throws {AppError} E_VALIDATION (future issue date, or holder email already a student elsewhere), E_CERT_NUMBER_COLLISION,
   *   E_DUPLICATE_CERTIFICATE, E_PINATA_FAILED, E_PDF_COMPILE_FAILED, or a chain-adapter error.
   */
  const issue = async (input, actor) => {
    if (new Date(input.issueDate).getTime() > Date.now()) {
      throw new AppError(ERROR_CODE.E_VALIDATION, 'The issue date cannot be in the future.', {
        fields: [{ path: 'issueDate', message: 'The issue date cannot be in the future.' }],
      });
    }

    // Resolves an existing student by enrolment number, or auto-provisions one
    // (and, if needed, a placeholder account the holder can later link to by
    // signing up with the same email) — there is no separate "register a
    // student" step in this system; the first certificate issued to someone
    // is what brings their student record into existence.
    const student = await withTransaction((client) =>
      userRepo.resolveOrCreateStudentForIssuance(
        {
          institutionId: actor.institutionId,
          enrollmentNumber: input.enrollmentNumber,
          holderEmail: input.holderEmail,
          holderName: input.holderName,
          course: input.course,
        },
        client,
      ),
    );

    const institution = await institutionRepo.findById(actor.institutionId);
    if (!institution) {
      throw new AppError(ERROR_CODE.E_ISSUER_NOT_REGISTERED, 'Your institution is not registered.');
    }

    const issueYear = new Date(input.issueDate).getUTCFullYear();

    let certificateRow;
    let certificateNumber;
    let verifyUrl;
    let pdfBuffer;
    let templateVersion;
    let certificateHash;

    for (let attempt = 0; attempt < MAX_CERT_NUMBER_ATTEMPTS; attempt += 1) {
      certificateNumber = certIdLib.allocateCertificateNumber(institution.institution_code, issueYear);
      verifyUrl = `${config.verifyBaseUrl}/${certificateNumber}`;

      const qrPngBuffer = await qrLib.toBuffer(verifyUrl, { type: 'png', margin: 1 });

      let compiled;
      try {
        compiled = await pdfAdapter.compile({
          certificateNumber,
          holderName: input.holderName,
          title: input.title,
          certificateType: input.certificateType,
          course: input.course,
          gradeOrResult: input.gradeOrResult,
          issueDate: input.issueDate,
          institutionName: institution.institution_name,
          qrDataUrl: qrPngBuffer,
          attributes: input.attributes,
        });
      } catch (err) {
        throw new AppError(ERROR_CODE.E_PDF_COMPILE_FAILED, 'Could not generate the certificate document.', { cause: err });
      }

      pdfBuffer = compiled.buffer;
      templateVersion = compiled.templateVersion;
      certificateHash = hashLib.sha256Hex(pdfBuffer);

      try {
        // Persist-before-external-call: this INSERT is the very first side
        // effect of the pipeline, before any Pinata/chain call is made.
        // eslint-disable-next-line no-await-in-loop -- retries are sequential attempts at the SAME operation, not independent iterations
        certificateRow = await withTransaction((client) =>
          certificateRepo.insertPending(
            {
              studentId: student.studentId,
              institutionId: actor.institutionId,
              issuedBy: actor.userId,
              certificateNumber,
              title: input.title,
              certificateType: input.certificateType,
              issueDate: input.issueDate,
              // `course` and `gradeOrResult` have no dedicated certificate
              // columns in the approved schema (only `student.course` exists,
              // which reflects the student's *current* programme, not
              // necessarily what a given certificate was issued for) — they're
              // folded into `attributes` so the registry can filter/display
              // them and they survive exactly as printed on the document.
              attributes: { ...(input.attributes ?? {}), course: input.course, gradeOrResult: input.gradeOrResult },
              certificateHash,
              templateVersion,
            },
            client,
          ),
        );
        break;
      } catch (err) {
        if (isUniqueViolationOn(err, 'certificate_hash')) {
          const existing = await certificateRepo.findByHash(certificateHash);
          throw new AppError(
            ERROR_CODE.E_DUPLICATE_CERTIFICATE,
            'A certificate with identical content has already been issued.',
            { context: { existingCertificateId: existing?.certificate_id, existingCertificateNumber: existing?.certificate_number } },
          );
        }
        if (isUniqueViolationOn(err, 'certificate_number')) {
          if (attempt === MAX_CERT_NUMBER_ATTEMPTS - 1) {
            throw new AppError(ERROR_CODE.E_CERT_NUMBER_COLLISION, 'Could not allocate a unique certificate number. Please try again.', {
              cause: err,
            });
          }
          continue; // regenerate a fresh number and retry
        }
        throw err;
      }
    }

    // Step 7: pin to IPFS. A transient failure (Pinata/IPFS blip) is
    // retried a few times in-request before giving up — pinning the same
    // bytes twice is harmless (same content, same resulting CID), so this
    // retry is always safe to attempt. If every attempt fails, the
    // certificate is left at PENDING_STORAGE — NOT failed — so the
    // worker's reconciler keeps it queued rather than losing it outright;
    // see the thrown AppError's publicMeta for how a caller keeps tracking
    // this certificate through that.
    let pinResult;
    try {
      pinResult = await withRetry(() => pinataAdapter.pin(pdfBuffer, certificateNumber), {
        ...EXTERNAL_CALL_RETRY_OPTIONS,
        onRetry: (err, attempt) =>
          logger?.warn?.(
            { err, attempt, certificateId: certificateRow.certificate_id },
            'issuanceService: pin attempt failed, retrying',
          ),
      });
    } catch (err) {
      logger?.warn?.(
        { err, certificateId: certificateRow.certificate_id },
        'issuanceService: pin failed after retries — leaving PENDING_STORAGE for the reconciler to keep trying',
      );
      throw new AppError(
        ERROR_CODE.E_PINATA_FAILED,
        'The document could not be stored right now. This certificate has been created and will keep trying automatically.',
        {
          cause: err,
          context: { certificateId: certificateRow.certificate_id, certificateNumber },
          publicMeta: { certificateId: certificateRow.certificate_id, certificateNumber },
        },
      );
    }

    await withTransaction(async (client) => {
      await fileRepo.insert(certificateRow.certificate_id, `${certificateNumber}.pdf`, 'application/pdf', pinResult.cid, pdfBuffer.length, client);
      await lifecycleService.transition(
        certificateRow.certificate_id,
        CERT_STATE.PENDING_STORAGE,
        CERT_STATE.PENDING_ANCHOR,
        { actorUserId: actor.userId },
        client,
      );
    });

    // Step 8: anchor on-chain. Same short in-request retry as the pin step.
    // Anchoring is NOT naturally idempotent (a second broadcast for an
    // already-anchored hash reverts on-chain), so before giving up, check
    // the chain's own current state directly — if an earlier attempt's
    // broadcast actually succeeded but its result never reached us (e.g.
    // the connection dropped right after submission), this is a recovery,
    // not a failure, and must never be retried again from scratch.
    let anchorResult;
    try {
      anchorResult = await withRetry(() => chainAdapter.anchor(certificateHash, pinResult.cid, certificateRow.certificate_id), {
        ...EXTERNAL_CALL_RETRY_OPTIONS,
        onRetry: (err, attempt) =>
          logger?.warn?.(
            { err, attempt, certificateId: certificateRow.certificate_id },
            'issuanceService: anchor attempt failed, retrying',
          ),
      });
    } catch (err) {
      const chainFacts = await chainAdapter.check(certificateHash).catch(() => null);
      if (chainFacts?.isIssued) {
        logger?.info?.(
          { certificateId: certificateRow.certificate_id },
          'issuanceService: anchor call failed locally, but the chain shows it already succeeded — recovering instead of retrying',
        );
        anchorResult = { txHash: null, nonce: null, alreadyAnchored: true };
      } else {
        logger?.warn?.(
          { err, certificateId: certificateRow.certificate_id },
          'issuanceService: anchor failed after retries — leaving PENDING_ANCHOR for the reconciler to keep trying',
        );
        throw new AppError(
          ERROR_CODE.E_RPC_UNAVAILABLE,
          'The blockchain network could not be reached right now. This certificate has been created and will keep trying automatically.',
          {
            cause: err,
            context: { certificateId: certificateRow.certificate_id, certificateNumber },
            publicMeta: { certificateId: certificateRow.certificate_id, certificateNumber },
          },
        );
      }
    }

    const settledState = anchorResult.alreadyAnchored ? CERT_STATE.ACTIVE : CERT_STATE.ANCHORING;
    await withTransaction(async (client) => {
      if (!anchorResult.alreadyAnchored) {
        await txRepo.insert(
          {
            certificateId: certificateRow.certificate_id,
            transactionHash: anchorResult.txHash,
            transactionType: TRANSACTION_TYPE.ISSUE,
            network: config.chainNetwork,
            contractAddress: config.contractAddress,
            nonce: anchorResult.nonce,
          },
          client,
        );
      }
      await lifecycleService.transition(certificateRow.certificate_id, CERT_STATE.PENDING_ANCHOR, settledState, { actorUserId: actor.userId }, client);
    });

    await auditRepo.append(actor.userId, 'CERTIFICATE_ISSUED', 'certificate', certificateRow.certificate_id, {
      certificateNumber,
      txHash: anchorResult.txHash,
    });

    return {
      certificateId: certificateRow.certificate_id,
      certificateNumber,
      status: settledState,
      txHash: anchorResult.txHash,
      verifyUrl,
    };
  };

  return Object.freeze({ issue });
};
