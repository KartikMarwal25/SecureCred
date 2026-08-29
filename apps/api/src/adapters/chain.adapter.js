/**
 * The ONLY module in this codebase that imports 'ethers' (rule D4). Every
 * other file that needs a provider or a wallet goes through the small
 * `createProvider`/`createWallet`/`createRandomWallet` helpers exported here
 * (see custodianSigner.js and container.js) rather than importing 'ethers'
 * itself, so the contract ABI/address/call surface stays in one place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { AppError } from '../lib/errors.js';
import { ERROR_CODE } from '@securecred/shared';
import { toBytes32 } from '../lib/hash.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// adapters -> src -> apps/api -> apps -> <repo root>
const REPO_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Converts a UUID (e.g. a certificate_id) into the bytes32 shape the
 * contract's opaque `certificateRef` parameter expects.
 *
 * @param {string} uuid
 * @returns {string} `0x`-prefixed 66-char hex string.
 */
const uuidToBytes32 = (uuid) => `0x${uuid.replace(/-/g, '').padStart(64, '0')}`;

/**
 * Loads the ABI + deployed address for a network from
 * `contracts/deployments/<network>.json` (written by `contracts:deploy:local`
 * or the equivalent testnet/mainnet deploy script).
 *
 * @param {string} network
 * @returns {{address: string, abi: unknown[]}}
 * @throws {AppError} E_CHAIN_UNKNOWN if the deployment file doesn't exist yet.
 */
const loadDeployment = (network) => {
  const file = path.join(REPO_ROOT, 'contracts', 'deployments', `${network}.json`);
  if (!fs.existsSync(file)) {
    throw new AppError(
      ERROR_CODE.E_CHAIN_UNKNOWN,
      `Contract not deployed for network "${network}" — run contracts:deploy:local first.`,
      { context: { network, file } },
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};

/**
 * Creates a JSON-RPC provider. The sole entry point other modules use to get
 * an ethers provider without importing 'ethers' themselves.
 *
 * @param {string} rpcUrl
 * @returns {import('ethers').JsonRpcProvider}
 */
export const createProvider = (rpcUrl) => new ethers.JsonRpcProvider(rpcUrl);

/**
 * Wraps a raw private key into a provider-connected wallet.
 *
 * @param {string} privateKey
 * @param {import('ethers').Provider} provider
 * @returns {import('ethers').Wallet}
 * @throws {Error} If `privateKey` is not a valid private key.
 */
export const createWallet = (privateKey, provider) => new ethers.Wallet(privateKey, provider);

/**
 * Generates a fresh, provider-connected ephemeral wallet (dev-only fallback).
 *
 * @param {import('ethers').Provider} provider
 * @returns {import('ethers').Wallet}
 */
export const createRandomWallet = (provider) => ethers.Wallet.createRandom().connect(provider);

/**
 * Creates the on-chain adapter. All writes are signed and broadcast by the
 * injected `signer` and return immediately without waiting for confirmation
 * — confirmation tracking is the worker's job (eventListener.js/reconciler.js).
 *
 * @param {object} deps
 * @param {object} deps.config - Frozen app config (uses chainNetwork).
 * @param {import('ethers').Wallet} deps.signer - Provider-connected custodian wallet.
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen adapter: `{ anchor, revoke, check, receiptWithConfirmations, getContractInstance }`.
 */
export const createChainAdapter = ({ config, signer, logger }) => {
  const provider = signer.provider;

  // Deployment/contract resolution is deliberately lazy (not done at
  // construction time): container.js builds this adapter at boot, and a
  // contract not yet deployed for this network (common in local dev before
  // `contracts:deploy:local` has run) must not crash the whole API process
  // — it should only fail the specific request that actually needs the chain.
  let cached = null;
  const getContracts = () => {
    if (!cached) {
      const deployment = loadDeployment(config.chainNetwork);
      cached = {
        readContract: new ethers.Contract(deployment.address, deployment.abi, provider),
        writeContract: new ethers.Contract(deployment.address, deployment.abi, signer),
      };
    }
    return cached;
  };

  /**
   * Anchors a certificate fingerprint on-chain. Does not await confirmation.
   *
   * @param {string} certificateHash - 64-char hex SHA-256 digest.
   * @param {string} ipfsCid
   * @param {string} certificateRef - Off-chain correlation id (certificate_id UUID).
   * @returns {Promise<{txHash: string, nonce: number}>}
   */
  const anchor = async (certificateHash, ipfsCid, certificateRef) => {
    const { writeContract } = getContracts();
    const tx = await writeContract.anchorCertificate(toBytes32(certificateHash), ipfsCid, uuidToBytes32(certificateRef));
    logger?.info?.({ txHash: tx.hash, certificateRef }, 'chain.adapter: anchorCertificate broadcast');
    return { txHash: tx.hash, nonce: tx.nonce };
  };

  /**
   * Revokes an already-anchored certificate. Does not await confirmation.
   *
   * @param {string} certificateHash
   * @param {string} reason
   * @returns {Promise<{txHash: string, nonce: number}>}
   */
  const revoke = async (certificateHash, reason) => {
    const { writeContract } = getContracts();
    const tx = await writeContract.revokeCertificate(toBytes32(certificateHash), reason);
    logger?.info?.({ txHash: tx.hash, certificateHash }, 'chain.adapter: revokeCertificate broadcast');
    return { txHash: tx.hash, nonce: tx.nonce };
  };

  /**
   * Reads the current on-chain status of a certificate hash. Never reverts —
   * an unknown hash simply reports `isIssued: false`.
   *
   * @param {string} certificateHash
   * @returns {Promise<{isIssued: boolean, isRevoked: boolean, issuer: string, issuedAt: number, ipfsCid: string, revocationReason: string}>}
   */
  const check = async (certificateHash) => {
    const { readContract } = getContracts();
    const [isIssued, isRevoked, issuer, issuedAt, ipfsCid, revocationReason] =
      await readContract.checkCertificate(toBytes32(certificateHash));
    return { isIssued, isRevoked, issuer, issuedAt: Number(issuedAt), ipfsCid, revocationReason };
  };

  /**
   * Fetches a transaction's receipt (if mined) plus the number of
   * confirmations it currently has.
   *
   * @param {string} txHash
   * @returns {Promise<{receipt: import('ethers').TransactionReceipt|null, confirmations: number}>}
   */
  const receiptWithConfirmations = async (txHash) => {
    const [receipt, currentBlock] = await Promise.all([
      provider.getTransactionReceipt(txHash),
      provider.getBlockNumber(),
    ]);
    if (!receipt || receipt.blockNumber == null) return { receipt: null, confirmations: 0 };
    return { receipt, confirmations: currentBlock - receipt.blockNumber + 1 };
  };

  /**
   * @returns {import('ethers').Contract} A provider-bound (read-only) contract instance, e.g. for event subscriptions.
   */
  const getContractInstance = () => getContracts().readContract;

  return Object.freeze({ anchor, revoke, check, receiptWithConfirmations, getContractInstance });
};
