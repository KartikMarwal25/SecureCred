/**
 * Certificate-number allocation. The certificate number is a public-facing,
 * human-typeable identifier of the form `<INSTITUTION_CODE>-<YYYY>-<12 Crockford
 * Base32 chars>` (see certificateNumberSchema in @securecred/shared). It is
 * generated client-of-DB-side; the database's unique constraint is the actual
 * source of truth for collision-freedom, this module only makes collisions rare.
 */
import { randomBytes } from 'node:crypto';
import { CROCKFORD_BASE32_ALPHABET } from '@securecred/shared';

const RANDOM_SUFFIX_LENGTH = 12;

/**
 * Generates the 12-character cryptographically-random Crockford Base32 suffix.
 *
 * @returns {string} 12 characters drawn from CROCKFORD_BASE32_ALPHABET.
 */
const randomSuffix = () => {
  const bytes = randomBytes(RANDOM_SUFFIX_LENGTH);
  let out = '';
  for (let i = 0; i < RANDOM_SUFFIX_LENGTH; i += 1) {
    out += CROCKFORD_BASE32_ALPHABET[bytes[i] % CROCKFORD_BASE32_ALPHABET.length];
  }
  return out;
};

/**
 * Allocates a new candidate certificate number. This function does not check
 * uniqueness itself — callers must retry on the database's unique-constraint
 * violation (see issuanceService.js) up to a small number of attempts.
 *
 * @param {string} institutionCode - The issuing institution's short code (3-8 chars, e.g. "SKIT").
 * @param {number|string} issueYear - The 4-digit year the certificate is issued in.
 * @returns {string} A candidate certificate number matching certificateNumberSchema.
 * @throws {TypeError} If institutionCode or issueYear are missing/malformed.
 */
export const allocateCertificateNumber = (institutionCode, issueYear) => {
  if (typeof institutionCode !== 'string' || !/^[A-Z0-9]{3,8}$/.test(institutionCode)) {
    throw new TypeError('allocateCertificateNumber requires a 3-8 char uppercase alphanumeric institutionCode');
  }
  const year = String(issueYear);
  if (!/^\d{4}$/.test(year)) {
    throw new TypeError('allocateCertificateNumber requires a 4-digit issueYear');
  }
  return `${institutionCode}-${year}-${randomSuffix()}`;
};
