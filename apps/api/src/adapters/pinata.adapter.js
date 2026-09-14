/**
 * IPFS pinning via Pinata's REST API. Falls back to a local-disk DEV STORAGE
 * mode when `PINATA_JWT` is unset, so the whole pipeline can run end-to-end
 * on a laptop with no Pinata account. Uses Node's built-in fetch/FormData/Blob
 * — no extra HTTP client dependency.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../lib/errors.js';
import { withRetry } from '../lib/backoff.js';
import { sha256Hex } from '../lib/hash.js';
import { ERROR_CODE } from '@securecred/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// adapters -> src -> apps/api -> .devstorage
const DEV_STORAGE_DIR = path.resolve(__dirname, '../../.devstorage');

const PIN_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const AUTH_TEST_ENDPOINT = 'https://api.pinata.cloud/data/testAuthentication';
const PIN_TIMEOUT_MS = 20_000;
// Pinata's free-tier gateway has been observed taking 6-15+ seconds to serve
// a freshly-pinned file (cold-cache/throttling on that tier) — 5s was
// cutting off a request that would have succeeded a moment later.
const GATEWAY_TIMEOUT_MS = 20_000;

/**
 * Creates the Pinata/IPFS adapter.
 *
 * @param {object} deps
 * @param {object} deps.config - Frozen app config (uses pinataJwt, ipfsGateways).
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen adapter: `{ pin, fetchByCid, isAuthOk }`.
 */
export const createPinataAdapter = ({ config, logger }) => {
  let devWarningLogged = false;
  const warnDevMode = () => {
    if (!devWarningLogged) {
      devWarningLogged = true;
      logger.warn(
        '[pinata.adapter] PINATA_JWT not set — using local-disk DEV STORAGE, not real IPFS. Do not use in production.',
      );
    }
  };

  const devPin = async (buffer) => {
    warnDevMode();
    const fakeCid = `devcid-${sha256Hex(buffer).slice(0, 32)}`;
    await mkdir(DEV_STORAGE_DIR, { recursive: true });
    await writeFile(path.join(DEV_STORAGE_DIR, fakeCid), buffer);
    return { cid: fakeCid };
  };

  const devFetch = async (cid) => {
    try {
      return await readFile(path.join(DEV_STORAGE_DIR, cid));
    } catch (err) {
      throw new AppError(ERROR_CODE.E_IPFS_UNAVAILABLE, 'The certificate document is unavailable right now.', {
        cause: err,
        context: { cid },
      });
    }
  };

  /**
   * Pins a buffer to IPFS (or local dev storage). Real requests retry with
   * exponential backoff and a bounded 20s timeout per attempt.
   *
   * @param {Buffer} buffer
   * @param {string} certificateNumber - Used as the uploaded filename for traceability in the Pinata dashboard.
   * @returns {Promise<{cid: string}>}
   * @throws {AppError} E_PINATA_FAILED if all retries are exhausted.
   */
  const pin = async (buffer, certificateNumber) => {
    if (!config.pinataJwt) {
      return devPin(buffer);
    }

    try {
      return await withRetry(
        async () => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), PIN_TIMEOUT_MS);
          try {
            const form = new FormData();
            const blob = new Blob([buffer], { type: 'application/pdf' });
            form.append('file', blob, `${certificateNumber}.pdf`);
            form.append('pinataMetadata', JSON.stringify({ name: certificateNumber }));

            const response = await fetch(PIN_ENDPOINT, {
              method: 'POST',
              headers: { Authorization: `Bearer ${config.pinataJwt}` },
              body: form,
              signal: controller.signal,
            });

            if (!response.ok) {
              const text = await response.text().catch(() => '');
              throw new Error(`Pinata pin failed: ${response.status} ${text}`.trim());
            }

            const json = await response.json();
            return { cid: json.IpfsHash };
          } finally {
            clearTimeout(timeout);
          }
        },
        { maxAttempts: 3, baseMs: 250, capMs: 4000 },
      );
    } catch (err) {
      throw new AppError(ERROR_CODE.E_PINATA_FAILED, 'Could not store the certificate document. Please try again.', {
        cause: err,
        context: { certificateNumber },
      });
    }
  };

  /**
   * Fetches a previously-pinned document by CID, trying each configured
   * gateway in order (5s timeout each, no per-gateway retry). `devcid-`
   * prefixed CIDs are read back from local dev storage instead.
   *
   * @param {string} cid
   * @returns {Promise<Buffer>}
   * @throws {AppError} E_IPFS_UNAVAILABLE if every gateway (or dev storage) fails.
   */
  const fetchByCid = async (cid) => {
    if (cid.startsWith('devcid-')) {
      return devFetch(cid);
    }

    for (const gateway of config.ipfsGateways) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
      try {
        // Sequential fallthrough across gateways is intentional: each gateway
        // is only worth trying if the previous one already failed.
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`${gateway.replace(/\/$/, '')}/${cid}`, { signal: controller.signal });
        if (!response.ok) continue;
        // eslint-disable-next-line no-await-in-loop
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch {
        continue; // try the next gateway
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new AppError(ERROR_CODE.E_IPFS_UNAVAILABLE, 'The certificate document is unavailable right now.', {
      context: { cid },
    });
  };

  /**
   * Lightweight auth-check used by the health endpoint. Reports 'dev-mode'
   * when no JWT is configured.
   *
   * @returns {Promise<'ok'|'dev-mode'|'down'>}
   */
  const isAuthOk = async () => {
    if (!config.pinataJwt) return 'dev-mode';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
      try {
        const response = await fetch(AUTH_TEST_ENDPOINT, {
          headers: { Authorization: `Bearer ${config.pinataJwt}` },
          signal: controller.signal,
        });
        return response.ok ? 'ok' : 'down';
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return 'down';
    }
  };

  return Object.freeze({ pin, fetchByCid, isAuthOk });
};
