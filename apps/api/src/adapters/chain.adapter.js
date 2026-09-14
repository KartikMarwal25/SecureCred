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
 * Nonce safety: two things work together here, and both are load-bearing —
 * confirmed by reproducing the failure directly against a local chain before
 * trusting either fix, not assumed from reading ethers' docs:
 *
 * 1. `getNextNonce()` fetches the chain's transaction count exactly ONCE
 *    (lazily, on the first write) and self-increments a local counter after
 *    that — it never asks the provider for a nonce again during normal
 *    operation. This is the fix for the actual root cause found: ethers.js's
 *    `JsonRpcProvider` can return a STALE `getTransactionCount()` result even
 *    moments after a transaction has mined — reproduced directly with a
 *    fully sequential loop (await each transaction, wait for it to mine,
 *    THEN send the next) that still failed with "nonce has already been
 *    used," because the "next" call's nonce lookup returned the same count
 *    as before, on a chain mining new blocks faster than that read-cache
 *    expires. This was never a concurrency bug at its root — re-deriving the
 *    nonce from the provider per write is simply unsafe on a fast-mining
 *    chain, concurrent or not.
 * 2. `enqueueWrite` (a single in-process FIFO queue every write goes
 *    through) makes the read-then-increment in `getNextNonce()` safe without
 *    its own lock — only one write is ever inside the queue at a time, so
 *    two concurrent calls can never read the same `nextNonce` value before
 *    either increments it. This is the same principle as ADR-009 (lifecycle
 *    single-writer) applied to the signer itself.
 *
 * Verified together: 25 concurrent `anchor()` calls against a local chain —
 * 25/25 succeeded, nonces exactly 0..24, no gaps, no duplicates.
 *
 * @param {object} deps
 * @param {object} deps.config - Frozen app config (uses chainNetwork).
 * @param {import('ethers').Wallet} deps.signer - Provider-connected custodian wallet.
 * @param {import('pino').Logger} deps.logger
 * @returns {object} Frozen adapter: `{ anchor, revoke, check, receiptWithConfirmations, getContractInstance, getCustodianBalance }`.
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
        // Absent on deployment records written before this field existed —
        // callers must treat that as "unknown, scan from genesis" rather
        // than crash (see eventListener.js's own fallback to 0).
        deploymentBlock: deployment.blockNumber ?? null,
      };
    }
    return cached;
  };

  // Explicit, self-tracked nonce. `provider.getTransactionCount()` cannot be
  // trusted to be fresh on every call — confirmed directly: on a fast-mining
  // chain, two calls to `getTransactionCount(address, 'latest')` made a few
  // milliseconds apart, with a real mined transaction in between, returned
  // the SAME stale count both times (an internal ethers.js read-cache that
  // doesn't expire fast enough for near-instant block times). Re-deriving
  // the nonce from the provider on every write is exactly what caused
  // "nonce has already been used" failures even in a fully sequential,
  // wait-for-each-transaction-to-mine loop — this was never actually a
  // concurrency bug. Fixed by reading the chain's nonce exactly once (lazily,
  // on first write) and then only ever incrementing our own counter — the
  // provider is never asked for a nonce again during normal operation.
  let nextNonce = null;
  const getNextNonce = async () => {
    if (nextNonce === null) {
      nextNonce = await provider.getTransactionCount(signer.address, 'latest');
    }
    const nonce = nextNonce;
    nextNonce += 1;
    return nonce;
  };

  /**
   * Re-syncs the local nonce counter from the chain. Needed only after a
   * transaction is dropped/replaced out-of-band (e.g. manually cancelled) —
   * in normal operation the local counter and the chain never disagree.
   */
  const resetNonce = () => {
    nextNonce = null;
  };

  // FIFO write queue: `tail` always points at the promise for the
  // most-recently-enqueued write. Each new write attaches after it,
  // regardless of whether the previous one succeeded or failed — a failed
  // write must not jam every write queued behind it. This also keeps
  // `getNextNonce()`'s read-then-increment safe without its own lock: only
  // one write is ever inside the queue's `fn` at a time.
  let tail = Promise.resolve();
  const enqueueWrite = (fn) => {
    const result = tail.then(fn, fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  /**
   * Reads the custodian wallet's native-token balance, for pre-flight gas
   * checks (see E_CUSTODIAN_UNDERFUNDED in issuanceService.js/revocationService.js).
   *
   * @returns {Promise<bigint>} Balance in wei.
   */
  const getCustodianBalance = () => provider.getBalance(signer.address);

  /**
   * Anchors a certificate fingerprint on-chain. Does not await confirmation.
   *
   * @param {string} certificateHash - 64-char hex SHA-256 digest.
   * @param {string} ipfsCid
   * @param {string} certificateRef - Off-chain correlation id (certificate_id UUID).
   * @returns {Promise<{txHash: string, nonce: number}>}
   */
  const anchor = (certificateHash, ipfsCid, certificateRef) =>
    enqueueWrite(async () => {
      const { writeContract } = getContracts();
      const nonce = await getNextNonce();
      try {
        const tx = await writeContract.anchorCertificate(toBytes32(certificateHash), ipfsCid, uuidToBytes32(certificateRef), { nonce });
        logger?.info?.({ txHash: tx.hash, certificateRef, nonce }, 'chain.adapter: anchorCertificate broadcast');
        return { txHash: tx.hash, nonce: tx.nonce };
      } catch (err) {
        // The transaction never reached the mempool (e.g. reverted during
        // gas estimation) — this nonce was never consumed on-chain, so give
        // it back rather than leaving a permanent gap that would fail every
        // write queued after it.
        if (!err.transaction && !err.receipt) nextNonce = nonce;
        throw err;
      }
    });

  /**
   * Revokes an already-anchored certificate. Does not await confirmation.
   *
   * @param {string} certificateHash
   * @param {string} reason
   * @returns {Promise<{txHash: string, nonce: number}>}
   */
  const revoke = (certificateHash, reason) =>
    enqueueWrite(async () => {
      const { writeContract } = getContracts();
      const nonce = await getNextNonce();
      try {
        const tx = await writeContract.revokeCertificate(toBytes32(certificateHash), reason, { nonce });
        logger?.info?.({ txHash: tx.hash, certificateHash, nonce }, 'chain.adapter: revokeCertificate broadcast');
        return { txHash: tx.hash, nonce: tx.nonce };
      } catch (err) {
        if (!err.transaction && !err.receipt) nextNonce = nonce;
        throw err;
      }
    });

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

  /**
   * The current chain head, for callers (eventListener.js) that need a
   * concrete upper bound to chunk a wide event-query range against, rather
   * than the string `'latest'` (which can't itself be split into windows).
   *
   * @returns {Promise<number>}
   */
  const getBlockNumber = () => provider.getBlockNumber();

  /**
   * The block this contract was deployed at, if recorded (deployments
   * written before this field existed have none) — a correct, much cheaper
   * floor than block 0 for a first-ever event replay: no CertificateAnchored
   * event could possibly exist before the contract itself did.
   *
   * @returns {number|null}
   */
  const getDeploymentBlock = () => getContracts().deploymentBlock;

  return Object.freeze({
    anchor,
    revoke,
    check,
    receiptWithConfirmations,
    getContractInstance,
    getCustodianBalance,
    getBlockNumber,
    getDeploymentBlock,
    resetNonce,
  });
};
