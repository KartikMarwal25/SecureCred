/**
 * Content-fingerprinting helpers used throughout the issuance/verification pipeline.
 * These are pure functions with no I/O — safe to import from any layer.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Computes the lowercase hex-encoded SHA-256 digest of a buffer.
 *
 * @param {Buffer} buffer - Bytes to hash (e.g. a finalized certificate PDF).
 * @returns {string} 64-character lowercase hex digest.
 * @throws {TypeError} If `buffer` is not a Buffer/Uint8Array.
 */
export const sha256Hex = (buffer) => {
  if (!(buffer instanceof Uint8Array)) {
    throw new TypeError('sha256Hex expects a Buffer/Uint8Array');
  }
  return createHash('sha256').update(buffer).digest('hex');
};

/**
 * Converts a hex-encoded 32-byte digest into a `0x`-prefixed bytes32 string,
 * matching the on-chain `bytes32 certificateHash` parameter shape.
 *
 * @param {string} hex - 64-character hex digest, with or without a `0x` prefix.
 * @returns {string} `0x`-prefixed, 66-character lowercase hex string.
 * @throws {TypeError} If `hex` is not a well-formed 32-byte hex string.
 */
export const toBytes32 = (hex) => {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(stripped)) {
    throw new TypeError('toBytes32 expects a 64-character hex string (32 bytes)');
  }
  return `0x${stripped.toLowerCase()}`;
};

/**
 * Constant-time comparison of two hex-encoded fingerprints, so that a
 * verification path never leaks timing information about how much of a
 * hash matched (BR-07, tamper-detection integrity).
 *
 * @param {string} a - First hex digest.
 * @param {string} b - Second hex digest.
 * @returns {boolean} True if the two digests represent identical bytes.
 */
export const fingerprintsEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const normalizedA = a.startsWith('0x') ? a.slice(2) : a;
  const normalizedB = b.startsWith('0x') ? b.slice(2) : b;
  if (normalizedA.length !== normalizedB.length) return false;
  if (!/^[0-9a-fA-F]*$/.test(normalizedA) || !/^[0-9a-fA-F]*$/.test(normalizedB)) return false;
  const bufA = Buffer.from(normalizedA, 'hex');
  const bufB = Buffer.from(normalizedB, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};
