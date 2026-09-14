import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
// Exempted from rule D4 (only chain.adapter.js may import ethers) in
// eslint.config.js's ignores list, same as container.js/worker.js — this is
// a real-chain integration test that needs ethers directly to register a
// throwaway test issuer on the local chain (registerIssuer isn't part of
// chain.adapter.js's own exposed surface; application code never calls it).
import { ethers } from 'ethers';
import { createChainAdapter, createProvider, createWallet } from './chain.adapter.js';

/**
 * Real-chain regression test for the nonce race fixed in chain.adapter.js.
 * Deliberately NOT mocked: the bug this guards against (ethers.js returning
 * a stale `getTransactionCount()` result on a fast-mining chain) can only
 * be reproduced against a real node — a mock would just replay whatever
 * behavior the mock author assumed, which is exactly how a bug like this
 * stays invisible. Spins up a real, local, free Hardhat node — no real
 * funds, no real network, nothing that costs anything.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CONTRACTS_DIR = path.join(REPO_ROOT, 'contracts');
const DEPLOYMENT_FILE = path.join(CONTRACTS_DIR, 'deployments', 'localhost.json');

const RPC_URL = 'http://127.0.0.1:8545';
// Hardhat's well-known, publicly-documented local test accounts — funded
// only on this throwaway local chain, worthless anywhere real.
const OWNER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ISSUER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

let hardhatProcess;
let deploymentSnapshot;

async function waitForRpc(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Hardhat node did not become ready on ${RPC_URL} within ${timeoutMs}ms`);
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: true, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (output += d.toString()));
    child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${output}`))));
  });
}

describe('chain.adapter.js — nonce race regression (real local chain)', () => {
  beforeAll(async () => {
    // Preserve whatever deployment record already exists so this test
    // never permanently overwrites a real developer's local state.
    if (fs.existsSync(DEPLOYMENT_FILE)) {
      deploymentSnapshot = fs.readFileSync(DEPLOYMENT_FILE, 'utf8');
    }

    hardhatProcess = spawn('npx', ['hardhat', 'node'], { cwd: CONTRACTS_DIR, shell: true, stdio: 'ignore' });
    await waitForRpc();
    await run('npx', ['hardhat', 'run', 'scripts/deploy.js', '--network', 'localhost'], CONTRACTS_DIR);

    const provider = createProvider(RPC_URL);
    const owner = createWallet(OWNER_KEY, provider);
    const testIssuer = createWallet(TEST_ISSUER_KEY, provider);
    const deployment = JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
    const ownerContract = new ethers.Contract(deployment.address, deployment.abi, owner);
    await (await ownerContract.registerIssuer(testIssuer.address)).wait();
  }, 60000);

  afterAll(() => {
    hardhatProcess?.kill();
    if (deploymentSnapshot !== undefined) {
      fs.writeFileSync(DEPLOYMENT_FILE, deploymentSnapshot);
    } else if (fs.existsSync(DEPLOYMENT_FILE)) {
      fs.unlinkSync(DEPLOYMENT_FILE);
    }
  });

  it('assigns every nonce exactly once across many concurrent anchor() calls, with zero failures', async () => {
    const provider = createProvider(RPC_URL);
    const testIssuer = createWallet(TEST_ISSUER_KEY, provider);
    const adapter = createChainAdapter({ config: { chainNetwork: 'localhost' }, signer: testIssuer, logger: undefined });

    const startingNonce = await provider.getTransactionCount(testIssuer.address, 'latest');
    const N = 30;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const hash = ethers.keccak256(ethers.toUtf8Bytes(`chain-adapter-nonce-test-${i}-${Date.now()}-${Math.random()}`)).slice(2);
        return adapter
          .anchor(hash, `ipfs-cid-${i}`, randomUUID())
          .then((r) => ({ ok: true, ...r }))
          .catch((err) => ({ ok: false, error: err.shortMessage ?? err.message }));
      }),
    );

    const succeeded = results.filter((r) => r.ok);
    const nonces = succeeded.map((r) => r.nonce).sort((a, b) => a - b);
    const expectedNonces = Array.from({ length: N }, (_, i) => startingNonce + i);

    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(succeeded).toHaveLength(N);
    expect(nonces).toEqual(expectedNonces);
  }, 60000);

  it('reports the custodian balance as a positive bigint', async () => {
    const provider = createProvider(RPC_URL);
    const testIssuer = createWallet(TEST_ISSUER_KEY, provider);
    const adapter = createChainAdapter({ config: { chainNetwork: 'localhost' }, signer: testIssuer, logger: undefined });

    const balance = await adapter.getCustodianBalance();
    expect(typeof balance).toBe('bigint');
    expect(balance).toBeGreaterThan(0n);
  });
});
