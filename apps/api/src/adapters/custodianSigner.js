/**
 * The ONLY file that may reference `CUSTODIAN_PRIVATE_KEY` (read via
 * `config.custodianPrivateKey` — this module is the only consumer of that
 * config field anywhere else in the codebase; enforced by discipline/comment,
 * not a runtime check). No method here ever returns the raw private key.
 */
import { createWallet, createRandomWallet } from './chain.adapter.js';
import { AppError } from '../lib/errors.js';
import { ERROR_CODE } from '@securecred/shared';

let devWarningLogged = false;
const warnDevWallet = (logger) => {
  if (!devWarningLogged) {
    devWarningLogged = true;
    logger.warn(
      '[custodianSigner] CUSTODIAN_PRIVATE_KEY not set — using an ephemeral DEV wallet with no funds. ' +
        'Anchoring will fail unless you fund it or run against a local Hardhat node with pre-funded accounts.',
    );
  }
};

/**
 * Creates the custodian signer: the single backend-held wallet that anchors
 * and revokes certificates on behalf of every institution. Fails closed at
 * construction time in production if no valid key is configured ("never
 * attempt an unsigned transaction"); falls back to an ephemeral dev wallet
 * outside production.
 *
 * @param {object} deps
 * @param {object} deps.config - Frozen app config (uses custodianPrivateKey, nodeEnv).
 * @param {import('ethers').Provider} deps.provider
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen signer: `{ address: string, connect: () => import('ethers').Wallet }`.
 * @throws {AppError} If no usable key is available in production.
 */
export const createCustodianSigner = ({ config, provider, logger }) => {
  let wallet = null;

  if (config.custodianPrivateKey) {
    try {
      wallet = createWallet(config.custodianPrivateKey, provider);
    } catch (err) {
      wallet = null;
      if (config.nodeEnv === 'production') {
        throw new AppError(ERROR_CODE.E_INTERNAL, 'CUSTODIAN_PRIVATE_KEY is malformed.', {
          status: 500,
          cause: err,
        });
      }
    }
  }

  if (!wallet) {
    if (config.nodeEnv === 'production') {
      throw new AppError(ERROR_CODE.E_INTERNAL, 'CUSTODIAN_PRIVATE_KEY is required in production.', {
        status: 500,
      });
    }
    warnDevWallet(logger);
    wallet = createRandomWallet(provider);
  }

  const address = wallet.address;

  return Object.freeze({
    address,
    /** @returns {import('ethers').Wallet} The provider-connected custodian wallet. */
    connect: () => wallet,
  });
};
