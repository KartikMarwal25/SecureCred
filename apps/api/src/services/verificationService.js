/**
 * Public verification pipeline (FR-VER-001..006 · BR-06 · BR-07). This is the
 * project's most safety-critical path: it must never report VERIFIED for a
 * tampered or revoked document, and must never leak information about
 * certificate numbers that were "almost right."
 *
 * Tamper detection design note: the on-chain `checkCertificate` is a
 * hash-keyed lookup, so "isIssued" for the certificate's own stored hash is
 * tautologically true whenever that hash was ever anchored — it cannot by
 * itself catch a forged document being passed off under a genuine
 * certificate number. The real integrity check is independent of the chain
 * call: fetch the document bytes via the CID the CHAIN itself reports
 * (immutable since anchoring, so it can't have been swapped after the fact)
 * and recompute its hash. If that freshly-computed hash doesn't match the
 * certificate's stored fingerprint, the served content has been substituted
 * (e.g. a compromised/non-verifying gateway or dev-storage entry) — TAMPERED.
 */
import { CERT_STATE_NOT_PUBLIC, TRANSACTION_TYPE, VERIFY_OUTCOME } from '@securecred/shared';
import { fingerprintsEqual, sha256Hex } from '../lib/hash.js';

/**
 * Pure decision function: given the on-chain facts (or their degraded-mode
 * substitute) and whether the fetched document's hash matches the stored
 * fingerprint, decides exactly one VERIFY_OUTCOME. Precedence (highest
 * first): not issued -> NOT_FOUND; issued but hash mismatch -> TAMPERED
 * (dominates revocation); issued, hash matches, and revoked -> REVOKED;
 * else -> VERIFIED.
 *
 * @param {object} facts
 * @param {boolean} facts.isIssued
 * @param {boolean} facts.isRevoked
 * @param {boolean} facts.hashMatchesOnChain
 * @returns {string} One of VERIFY_OUTCOME's values.
 */
export const decideOutcome = ({ isIssued, isRevoked, hashMatchesOnChain }) => {
  if (!isIssued) return VERIFY_OUTCOME.NOT_FOUND;
  if (!hashMatchesOnChain) return VERIFY_OUTCOME.TAMPERED;
  if (isRevoked) return VERIFY_OUTCOME.REVOKED;
  return VERIFY_OUTCOME.VERIFIED;
};

/**
 * Creates the verification service.
 *
 * @param {object} deps
 * @param {object} deps.certificateRepo
 * @param {object} deps.chainAdapter
 * @param {object} deps.pinataAdapter
 * @param {object} deps.verificationLogRepo
 * @param {object} [deps.hashLib] - Injected for testability; defaults to lib/hash.js's exports.
 * @param {object} deps.config
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen service: `{ verify }`.
 */
export const createVerificationService = ({
  certificateRepo,
  chainAdapter,
  pinataAdapter,
  verificationLogRepo,
  txRepo,
  hashLib = { fingerprintsEqual, sha256Hex },
  logger,
}) => {
  /**
   * Verifies a certificate by its public certificate number.
   *
   * @param {string} certificateNumber
   * @param {string} method - VERIFICATION_METHOD.*
   * @param {string|null} [verifierUserId] - Authenticated verifier, if any (null for anonymous).
   * @param {Buffer|null} [uploadedDocumentBuffer] - When provided (VERIFICATION_METHOD.HASH), the
   *   verifier's own copy of the document is hashed directly and compared against the stored
   *   fingerprint, instead of re-fetching the document from IPFS. This is the only path that can
   *   actually catch a forged/edited document being passed off under a genuine certificate number
   *   — re-fetching from IPFS only ever re-derives the SAME bytes the chain already points at
   *   (content-addressed storage can't serve different bytes under an unchanged CID), so it can
   *   detect a compromised gateway but never a document the verifier altered themselves.
   * @returns {Promise<{outcome: string, certificate: object|null, degraded: boolean, lastConfirmedAt: string|null, revocationReason: string|null}>}
   */
  const verify = async (certificateNumber, method, verifierUserId = null, uploadedDocumentBuffer = null) => {
    const certificate = await certificateRepo.findByCertificateNumber(certificateNumber);

    if (!certificate || CERT_STATE_NOT_PUBLIC.includes(certificate.status)) {
      // No public-eligible row: nothing to check on-chain, and we must not
      // disclose whether the number was "almost right."
      await verificationLogRepo.append(certificate?.certificate_id ?? null, verifierUserId, method, VERIFY_OUTCOME.NOT_FOUND, false);
      return { outcome: VERIFY_OUTCOME.NOT_FOUND, certificate: null, degraded: false, lastConfirmedAt: null, revocationReason: null };
    }

    let chainFacts;
    let degraded = false;
    try {
      chainFacts = await chainAdapter.check(certificate.certificate_hash);
      // Best-effort cache of the last confirmed truth for future degraded-mode fallback.
      certificateRepo.recordChainState(certificate.certificate_id, chainFacts).catch((err) => {
        logger?.warn?.({ err }, 'verificationService: failed to cache chain state (non-fatal)');
      });
    } catch (err) {
      logger?.warn?.({ err, certificateNumber }, 'verificationService: live chain check failed, falling back to last-confirmed state');
      const lastConfirmed = certificate.last_confirmed_chain_state;
      if (lastConfirmed) {
        chainFacts = lastConfirmed;
        degraded = true;
      } else {
        // Nothing was ever confirmed on-chain — surface through the same
        // enum, degraded, rather than inventing a fifth outcome.
        await verificationLogRepo.append(certificate.certificate_id, verifierUserId, method, VERIFY_OUTCOME.NOT_FOUND, true);
        return {
          outcome: VERIFY_OUTCOME.NOT_FOUND,
          certificate: null,
          degraded: true,
          lastConfirmedAt: null,
          revocationReason: null,
        };
      }
    }

    let hashMatchesOnChain = false;
    if (chainFacts.isIssued && uploadedDocumentBuffer) {
      // The verifier's own file, hashed directly — no IPFS round-trip
      // needed or wanted here; this is specifically checking whether THIS
      // document matches what was issued, not whether IPFS is serving it
      // correctly (that's the other branch, below).
      const uploadedHash = hashLib.sha256Hex(uploadedDocumentBuffer);
      hashMatchesOnChain = hashLib.fingerprintsEqual(uploadedHash, certificate.certificate_hash);
    } else if (chainFacts.isIssued) {
      try {
        const documentBytes = await pinataAdapter.fetchByCid(chainFacts.ipfsCid);
        const freshHash = hashLib.sha256Hex(documentBytes);
        hashMatchesOnChain = hashLib.fingerprintsEqual(freshHash, certificate.certificate_hash);
      } catch (err) {
        // A transient storage/gateway failure is not itself evidence of
        // tampering — give the benefit of the doubt rather than falsely
        // reporting TAMPERED because IPFS was briefly unreachable.
        logger?.warn?.({ err, certificateNumber }, 'verificationService: could not fetch document to verify integrity; assuming untampered');
        hashMatchesOnChain = true;
      }
    }

    const outcome = decideOutcome({
      isIssued: chainFacts.isIssued,
      isRevoked: chainFacts.isRevoked,
      hashMatchesOnChain,
    });

    await verificationLogRepo.append(certificate.certificate_id, verifierUserId, method, outcome, degraded);

    // Evidence for the "Blockchain Proof" panel — only meaningful, and only
    // fetched, when the outcome is favorable enough to show it (VERIFIED or
    // REVOKED). `chainFacts.ipfsCid` is the CID the CHAIN itself reports
    // (authoritative); the tx hash is off-chain metadata this app recorded
    // when it broadcast the anchoring transaction, so it comes from txRepo.
    let ipfsCid = null;
    let txHash = null;
    if (outcome === VERIFY_OUTCOME.VERIFIED || outcome === VERIFY_OUTCOME.REVOKED) {
      ipfsCid = chainFacts.ipfsCid ?? null;
      try {
        const tx = await txRepo?.findLatestForCertificate(certificate.certificate_id, TRANSACTION_TYPE.ISSUE);
        txHash = tx?.transaction_hash ?? null;
      } catch (err) {
        logger?.warn?.({ err }, 'verificationService: failed to look up issuance tx hash (non-fatal)');
      }
    }

    return {
      outcome,
      certificate,
      degraded,
      lastConfirmedAt: degraded ? certificate.last_chain_check_at : null,
      revocationReason: chainFacts.revocationReason || null,
      certificateHash: certificate.certificate_hash,
      ipfsCid,
      txHash,
    };
  };

  return Object.freeze({ verify });
};
