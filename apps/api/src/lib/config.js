/**
 * Centralized environment configuration. Loads the repo-root `.env`, validates
 * every value with zod, and fails the boot (throws at import time) if anything
 * required is missing or malformed — no module downstream should ever read
 * `process.env` directly (NFR-MAINT).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// apps/api/src/lib -> apps/api/src -> apps/api -> apps -> <repo root>
const REPO_ROOT = path.resolve(__dirname, '../../../..');

dotenv.config({ path: path.join(REPO_ROOT, '.env') });

const csvList = (value) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),
  VERIFY_BASE_URL: z.string().min(1).default('http://localhost:5173/verify'),
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  DATABASE_URL: z.string().min(1).default('postgres://securecred_app:securecred_dev_password@localhost:5432/securecred'),
  // Off by default — unchanged behavior for local Postgres (no SSL) and for
  // Docker Compose's own postgres service. A managed instance (AWS RDS, GCP
  // Cloud SQL, etc.) typically requires TLS; DATABASE_SSL=true enables it.
  // DATABASE_SSL_REJECT_UNAUTHORIZED stays true (verify the server cert)
  // unless a specific managed provider's cert isn't in Node's default trust
  // store, in which case an operator sets it to false deliberately — never
  // as this schema's own default.
  DATABASE_SSL: z.coerce.boolean().default(false),
  DATABASE_SSL_REJECT_UNAUTHORIZED: z.coerce.boolean().default(true),

  CLERK_PUBLISHABLE_KEY: z.string().default(''),
  CLERK_SECRET_KEY: z.string().default(''),
  CLERK_WEBHOOK_SECRET: z.string().default(''),

  PINATA_JWT: z.string().default(''),
  IPFS_GATEWAYS: z.string().default('https://gateway.pinata.cloud/ipfs,https://ipfs.io/ipfs'),

  // Must match a Hardhat network name (see contracts/hardhat.config.js) and the
  // filename contracts/scripts/deploy.js writes under contracts/deployments/.
  CHAIN_NETWORK: z.string().default('localhost'),
  RPC_URL: z.string().default('http://127.0.0.1:8545'),
  CHAIN_ID: z.coerce.number().int().positive().default(1337),
  CONTRACT_ADDRESS: z.string().default(''),
  CONFIRMATION_DEPTH: z.coerce.number().int().min(1).default(1),
  CUSTODIAN_PRIVATE_KEY: z.string().default(''),

  RATE_VERIFY_PER_MINUTE: z.coerce.number().int().positive().default(30),
  RATE_VERIFY_PER_HOUR: z.coerce.number().int().positive().default(600),
  RATE_AUTH_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_ISSUANCE_PER_HOUR: z.coerce.number().int().positive().default(60),
  RATE_REVOCATION_PER_HOUR: z.coerce.number().int().positive().default(20),

  STALL_THRESHOLD_SEC: z.coerce.number().int().positive().default(120),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

const env = parsed.data;

/**
 * Frozen, validated application configuration. The single source of truth for
 * every environment-derived value in the API. Never read `process.env`
 * directly outside this module.
 * @type {Readonly<object>}
 */
export const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  verifyBaseUrl: env.VERIFY_BASE_URL,
  corsAllowedOrigins: csvList(env.CORS_ALLOWED_ORIGINS),

  databaseUrl: env.DATABASE_URL,
  databaseSsl: env.DATABASE_SSL,
  databaseSslRejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED,

  clerkPublishableKey: env.CLERK_PUBLISHABLE_KEY,
  clerkSecretKey: env.CLERK_SECRET_KEY,
  clerkWebhookSecret: env.CLERK_WEBHOOK_SECRET,

  pinataJwt: env.PINATA_JWT,
  ipfsGateways: csvList(env.IPFS_GATEWAYS),

  chainNetwork: env.CHAIN_NETWORK,
  rpcUrl: env.RPC_URL,
  chainId: env.CHAIN_ID,
  contractAddress: env.CONTRACT_ADDRESS,
  confirmationDepth: env.CONFIRMATION_DEPTH,
  custodianPrivateKey: env.CUSTODIAN_PRIVATE_KEY,

  rateLimits: Object.freeze({
    verifyPerMinute: env.RATE_VERIFY_PER_MINUTE,
    verifyPerHour: env.RATE_VERIFY_PER_HOUR,
    authPerMinute: env.RATE_AUTH_PER_MINUTE,
    issuancePerHour: env.RATE_ISSUANCE_PER_HOUR,
    revocationPerHour: env.RATE_REVOCATION_PER_HOUR,
  }),

  stallThresholdSec: env.STALL_THRESHOLD_SEC,

  repoRoot: REPO_ROOT,
});
