# SecureCredRegistry — gas profile

Measured via `hardhat-gas-reporter` against the Sprint-2 contract test suite
(`contracts/test/`, 18 tests), Solidity 0.8.36, optimizer enabled at 200 runs, local
Hardhat network (no real gas price — costs are consensus-identical on Polygon Amoy).

To reproduce:

```bash
cd contracts
REPORT_GAS=true npx hardhat test
```

## Deployment

| Contract | Gas | % of a 60M gas block |
|---|---|---|
| `SecureCredRegistry` | 762,987 | 1.3% |

## Per-call costs

| Method | Min | Max | Avg | Notes |
|---|---|---|---|---|
| `registerIssuer` | 47,272 | 47,284 | 47,276 | One-time per institution onboarded |
| `deregisterIssuer` | 25,330 | 27,330 | 26,330 | Rare — offboarding |
| `anchorCertificate` | 166,105 | 166,117 | 166,115 | Once per certificate issued — the hot path |
| `revokeCertificate` | 55,567 | 55,603 | 55,591 | Once per revocation |

`checkCertificate` (public verification) is not listed — it's a `view` call, so it
costs no gas when read off-chain via `eth_call` (the path every verifier actually
uses); it would only cost gas if called from inside another transaction, which
nothing in this system does.

## What drives the cost

`anchorCertificate` is the most expensive write by a wide margin because it's the
only function that writes a full `Record` struct to a previously-empty storage slot
(`SSTORE` from zero → non-zero is the most expensive EVM storage operation, ~20,000
gas per slot) plus two dynamically-sized `string` fields (`ipfsCid`,
`revocationReason` — the latter written empty at anchor time but still allocates
storage). `revokeCertificate` is cheaper because it only flips an existing slot's
`bool`/`uint64` fields and writes one string (`SSTORE` non-zero → non-zero is
~5,000 gas, far cheaper than initializing a new slot).

## Cost at scale (Polygon Amoy / Polygon PoS economics)

Polygon gas prices are typically single-digit gwei. At a representative 30 gwei:

| Method | Gas | Cost @ 30 gwei | Cost @ 30 gwei, POL @ $0.20 |
|---|---|---|---|
| `anchorCertificate` | ~166,115 | ~0.00498 POL | ~$0.001 |
| `revokeCertificate` | ~55,591 | ~0.00167 POL | ~$0.0003 |

At this cost, issuing thousands of certificates per institution per year is
economically trivial on Polygon — this was the stated rationale (SRS/HLD) for
choosing Polygon over Ethereum mainnet for anchoring. Actual testnet costs will be
confirmed once the Amoy deployment (pending user go-ahead / testnet POL funding) is
live; these are Hardhat-measured gas units, which are chain-agnostic, multiplied by
representative Polygon gas-price/token-price assumptions rather than a live
measurement.

## No optimization work planned

At ~166k gas for the most expensive call (well under 1% of a Polygon block), and
with certificate issuance being a low-frequency, backend-initiated operation (not a
user-facing, latency-sensitive interaction), there is no gas-optimization backlog for
this contract. Effort here would trade code clarity for savings that don't move any
real cost or UX metric for this system.
