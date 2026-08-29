// SPDX-License-Identifier: MIT
require('@nomicfoundation/hardhat-toolbox');

// Load repo-root .env so a single set of secrets (RPC_URL, CUSTODIAN_PRIVATE_KEY, ...)
// can be shared across the monorepo. This file is intentionally defensive: contracts/
// must still compile and test with zero network secrets configured.
try {
  require('dotenv').config({ path: '../.env' });
} catch (err) {
  // dotenv not installed or .env missing — fall back to whatever is already in process.env.
}

const RPC_URL = process.env.RPC_URL || '';
const CUSTODIAN_PRIVATE_KEY = process.env.CUSTODIAN_PRIVATE_KEY || '';

// Only provide an accounts array when a real private key is configured; otherwise
// leave it empty so `hardhat compile` / `hardhat test` never fail on missing secrets.
const remoteAccounts = CUSTODIAN_PRIVATE_KEY ? [CUSTODIAN_PRIVATE_KEY] : [];

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  paths: {
    sources: './src',
  },
  solidity: {
    version: '0.8.36',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 1337,
    },
    // Same local chain, reached by its docker-compose service name instead
    // of localhost — used only inside the `chain`/`deploy-contract`/`api`/
    // `worker` containers (see docker-compose.yml and docker/chain.Dockerfile).
    dockerchain: {
      url: process.env.CHAIN_RPC_URL || 'http://chain:8545',
      chainId: 1337,
    },
    amoy: {
      url: RPC_URL || 'https://rpc-amoy.polygon.technology',
      chainId: 80002,
      accounts: remoteAccounts,
    },
    polygon: {
      url: RPC_URL || 'https://polygon-rpc.com',
      chainId: 137,
      accounts: remoteAccounts,
    },
  },
};
