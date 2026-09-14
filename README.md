# SecureCred

**Blockchain-Based Digital Certification System** — SKIT/CSE/2023-2027/26

SecureCred lets an institution issue a certificate that is cryptographically anchored on the Polygon blockchain, so its authenticity can be checked by anyone — instantly, by certificate ID or QR code, without ever contacting the issuing institution. A single backend-held "custodian wallet" signs every blockchain transaction, so neither institutions nor students ever need a crypto wallet or to pay gas.

Every verification resolves to exactly one of four outcomes: **VERIFIED**, **REVOKED**, **TAMPERED**, or **NOT FOUND** — the one guarantee the whole system is built around is that a tampered or forged document must never come back VERIFIED.

Team: Kartik Marwal (Team Lead — Blockchain/Architecture) · Jaideep Singh Chauhan (Backend) · Keshav Bheel (Frontend) · Kavish Mangal (Testing & Documentation). Mentor: Vikram Khandelwal.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4, react-router v7, Clerk (auth) |
| Backend | Node.js, Express 5, PostgreSQL 17 (`pg`, no ORM), Zod validation |
| Identity | Clerk (sessions/JWT) |
| Storage | IPFS via Pinata (pinning) |
| Blockchain | Solidity 0.8.36, Hardhat, Ethers.js v6, Polygon (Amoy testnet → mainnet) |
| Integrity | SHA-256 fingerprinting, deterministic PDF generation (`pdf-lib`) |
| Testing | Jest + Supertest (API/worker), Hardhat + Chai (contract) |
| Infra | Docker, Docker Compose |

## Architecture

A modular monolith (not microservices — see `docs/ARCHITECTURE.md` if you add one) with four deployables:

- **`apps/api`** — the REST API. Layered: `routes` → `services` (all business rules) → `repositories` (the only files allowed to touch `pg`) / `adapters` (the only files allowed to touch `ethers`, Pinata, Clerk).
- **`apps/worker`** — a background process: listens for `CertificateAnchored`/`CertificateRevoked` chain events and reconciles any certificate stuck mid-flight.
- **`apps/web`** — the React frontend: a public verifier portal, an institution dashboard, and a student "Your credentials" view, all in one bundle, routed by the signed-in user's role.
- **`contracts`** — `SecureCredRegistry.sol`, a small, non-upgradeable contract that stores only a certificate's hash, IPFS CID, issuer, timestamps, and revocation flag/reason — **never any personal data**.

The database is the fast operational record; the chain is the trust anchor and wins on any conflict. See `packages/shared` for the constants (`CERT_STATE`, `VERIFY_OUTCOME`, error codes, ...) and Zod schemas shared by both the API and the web client.

### Certificate lifecycle

```
PENDING_STORAGE → PENDING_ANCHOR → ANCHORING → ACTIVE → REVOKING → REVOKED
                                        ↓                    ↓
                                      FAILED               ACTIVE (tx dropped/reverted)
```

## Quick start — Docker (recommended)

Requires Docker only. This brings up Postgres, a local Hardhat chain, deploys the contract to it, runs migrations + demo seed data, and starts the API, worker, and web frontend — end to end, no third-party accounts needed:

```bash
docker compose up --build
```

Then open **http://localhost:5173**. Click **Sign in** → you'll land on `/dev-login` (Clerk isn't configured, so a local dev-mode sign-in stands in for it) and can continue as "institution" or "student" against the seeded demo data. The public verifier portal at `/verify` works with no sign-in at all.

Stop everything with `docker compose down` (add `-v` to also drop the Postgres volume and start from a clean database next time).

## Quick start — manual local dev

Requires Node.js 20+, PostgreSQL 17, and (for the blockchain layer) Hardhat.

```bash
npm install                                  # installs the workspace (packages/shared, apps/api, apps/worker, apps/web)
cd contracts && npm install && cd ..         # contracts is a standalone npm project

cp .env.example .env                         # then fill in DATABASE_URL at minimum; see below

# 1. Database (run Postgres 17 however you like, e.g. docker run -p 5432:5432 postgres:17)
node db/migrate.js up
node db/seeds/seed.js

# 2. Local blockchain
npm run contracts:node                       # keep running in its own terminal
npm run contracts:deploy:local               # in a second terminal, once the node is up

# 3. App processes (each in its own terminal)
npm run api:dev
npm run worker:dev
npm run web:dev
```

The API listens on `:4000`, the web app on `:5173`.

### Environment variables

See `.env.example` for the full list with comments. The two adapters that need real third-party accounts — **Clerk** (identity) and **Pinata** (IPFS pinning) — have built-in **dev-mode fallbacks**: leave `CLERK_SECRET_KEY`/`PINATA_JWT` blank and the API logs a loud one-time warning and switches to a local stand-in (an unsigned `dev:...` bearer token format, and content-addressed local-disk storage, respectively) so the whole issuance → anchor → verify → revoke flow works without either account. Fill them in with real values to exercise the real, fully-implemented paths.

**Want real sign-in/sign-up with 2FA, OAuth, and email verification?** That's a Clerk Dashboard configuration, not new code — see [docs/CLERK_SETUP.md](docs/CLERK_SETUP.md).

`CUSTODIAN_PRIVATE_KEY` in `.env` (and in `docker-compose.yml`) is Hardhat's well-known, publicly-documented default test account — funded with 10000 test ETH on any local Hardhat node, worthless anywhere else. Never reuse a well-known test key for a real deployment.

## Testing

```bash
npm run contracts:test --workspace=contracts   # 18 tests: contract correctness + access control
cd apps/api && npm test                        # 61 tests: pure logic, services, routes (no live DB/chain needed)
cd apps/worker && npm test                     # worker decision logic
cd apps/web && npm run build                    # production build must succeed cleanly
```

All of the above are green as of this commit. `verificationService.test.js` exhaustively covers all 8 boolean combinations of `{isIssued, hashMatchesOnChain, isRevoked}` against the required outcome precedence (integrity dominates revocation dominates existence) — this is the project's core "must never falsely say VERIFIED" guarantee.

## Repository layout

```
apps/
  api/src/{routes,middleware,services,adapters,repositories,lib,schemas}
  worker/src/{eventListener.js,reconciler.js,worker.js}
  web/src/{pages,components,hooks,api,auth,lib}
contracts/{src/SecureCredRegistry.sol,test/,scripts/deploy.js,deployments/}
db/{migrations/,seeds/,migrate.js}
packages/shared/src/{constants.js,schemas.js}   # imported by both apps/api and apps/web
docker/                                          # per-service Dockerfiles + nginx config
docker-compose.yml
```

## Scope decisions for this release

The SRS (v2.0/v2.1) explicitly defines only two authenticated roles — **institution** and **student** — plus an anonymous public verifier, and lists an admin console, mandatory 2FA, and bulk/batch CSV issuance as **out of scope** for this release (the approved LLD/SDD/Technical Design confirm this baseline). An early Figma exploration sketched a separate admin role as a future idea; it is **not** built here. TOTP 2FA, OAuth sign-in, and mandatory email verification *are* implemented, via Clerk's hosted auth UI — see [docs/CLERK_SETUP.md](docs/CLERK_SETUP.md).

Sign-up is self-service for both roles: a new account picks "student" or "institution" at `/choose-role` right after registering. Choosing "institution" is **auto-approved** — anyone can currently claim to be an institution and immediately get certificate-issuance rights. That's an acceptable tradeoff for local testing/demo use (this is what's currently deployed), but a real public deployment should gate new institution accounts behind manual review before activation instead (see docs/CLERK_SETUP.md §7). `db/seeds/seed.js` still shows the shape of a scripted/audited institution + staff account, which remains the safer provisioning path for a production deployment.

## Project timeline (Form 1/2, WBS)

Six sprints, 10 Aug 2026 → 15 Mar 2027 (see the submitted Project Plan / WBS / Milestone Timeline documents for the authoritative per-owner breakdown). This repository's initial build covers the full technical scope of Sprints 1–3 (architecture/setup, core module development, feature integration & verification — issuance, verification, revocation, IPFS storage, the verifier portal, institution/student dashboards) and a substantial portion of Sprint 4 (contract deployment tooling, chain event listener with replay, lifecycle reconciliation), built and verified end-to-end — including a full Docker Compose stack — ahead of a large part of the original schedule. Remaining scope for later sprints per the plan: a public testnet (Polygon Amoy) deployment record, a dedicated security-hardening/audit pass, accessibility audit sign-off, load/performance testing, and the mainnet release.
