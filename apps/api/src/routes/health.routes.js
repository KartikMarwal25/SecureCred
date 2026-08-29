/**
 * `/api/v1/health` — unauthenticated liveness/readiness probe. Reports each
 * real external dependency's status; degrades to 503 if any of them is down.
 */
import { Router } from 'express';

const TIMEOUT_MS = 3000;

const withTimeout = async (promise, ms) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Builds the `/api/v1/health` router.
 *
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {object} deps.pinataAdapter
 * @param {import('ethers').Provider|null} deps.provider - Null if the chain isn't configured yet.
 * @param {{address: string}} deps.custodianSigner
 * @returns {import('express').Router}
 */
export const createHealthRouter = ({ pool, pinataAdapter, provider, custodianSigner }) => {
  const router = Router();

  router.get('/', async (_req, res) => {
    const [postgres, pinata, rpc] = await Promise.all([
      withTimeout(pool.query('SELECT 1'), TIMEOUT_MS).then(
        () => 'ok',
        () => 'down',
      ),
      pinataAdapter.isAuthOk().catch(() => 'down'),
      provider
        ? withTimeout(provider.getBlockNumber(), TIMEOUT_MS).then(
            () => 'ok',
            () => 'down',
          )
        : Promise.resolve('unconfigured'),
    ]);

    const dependencies = { postgres, pinata, rpc };
    const anyRealDependencyDown = [postgres, rpc].includes('down');

    res.status(anyRealDependencyDown ? 503 : 200).json({
      status: anyRealDependencyDown ? 'degraded' : 'ok',
      dependencies,
      version: '1.0.0',
      custodian: { address: custodianSigner?.address ?? null },
    });
  });

  return router;
};
