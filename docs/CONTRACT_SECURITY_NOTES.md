# SecureCredRegistry — security self-audit notes

Informal internal review of `contracts/src/SecureCredRegistry.sol`, done in lieu of a
paid third-party audit (out of scope/budget for this capstone — see Risk Plan). This
is not a substitute for a professional audit before any mainnet deployment holding
real value; it documents the reasoning a reviewer would need to evaluate the contract
as it stands for the Polygon Amoy testnet deployment target.

## Scope

Single contract, single file, 197 lines, no inheritance, no external dependencies
(no OpenZeppelin, no imports at all). Compiled with Solidity 0.8.36, optimizer on,
200 runs.

## Threat model

- **No end-user wallets.** All state-changing calls (`anchorCertificate`,
  `revokeCertificate`, `registerIssuer`, `deregisterIssuer`) are made by a single
  backend-held custodian wallet (`chain.adapter.js` + `custodianSigner.js`). Students
  and verifiers never sign transactions. This eliminates an entire class of wallet-
  phishing / approval-scam risk that a typical dApp carries, at the cost of the
  custodian private key being a single point of compromise (see "Key custody" below).
- **Public read path.** `checkCertificate` is `view`, unauthenticated, and callable by
  anyone — this is intentional (SRS: public verification is a core requirement) and
  never reverts, including for unknown hashes, so it can't be used to enumerate valid
  vs. invalid hashes via revert-vs-success timing/gas differences.

## Checklist (SWC-registry-style, informal)

| Category | Finding |
|---|---|
| Reentrancy | **Not applicable.** The contract makes zero external calls — no `.call`, `.send`, `.transfer`, no calls to other contracts, no callbacks. There is nothing to re-enter. Checks-effects-interactions is still followed in `anchorCertificate`/`revokeCertificate` (storage written, then event emitted) as defensive style, not because it's load-bearing here. |
| Access control | `onlyOwner` / `onlyIssuer` modifiers gate every state-changing function. Ownership is single-address, non-transferable (no `transferOwnership`) — acceptable for a testnet/capstone deployment with one institution operator; would need a 2-step transfer or multisig before any production use with multiple stakeholders. |
| Integer overflow/underflow | Solidity ^0.8 has built-in checked arithmetic; `totalAnchored += 1` reverts on overflow (practically unreachable — would need 2^256 anchors). No unchecked blocks anywhere. |
| Timestamp dependence | `block.timestamp` is used for `issuedAt`/`revokedAt` display fields only, never for access control or fund logic. Miner manipulation of a few seconds has no exploitable effect. |
| Front-running | `anchorCertificate`/`revokeCertificate` are keyed by `certificateHash` (a keccak256 of the certificate payload) and gated to `onlyIssuer`; there is no bidding, ordering-sensitive, or value-transfer logic for a front-runner to profit from. Two issuers racing to anchor the *same* hash is already handled by `AlreadyAnchored` — first-in-block wins, second reverts cleanly. |
| Denial of service | No loops over unbounded arrays, no external calls that could revert/stall execution, no `selfdestruct`. `deregisterIssuer` is intentionally idempotent (no revert on double-call) so it can't be used to grief. String fields (`ipfsCid`, `revocationReason`) are caller-supplied and unbounded in length — a malicious *issuer* (already a trusted, owner-approved role) could pad these to raise gas cost of their own transaction, but this only costs the issuer themselves, not other users. |
| Upgradeability / proxy risk | None — no proxy, no `delegatecall`, no inline assembly. The contract is immutable by construction: what's deployed is what runs, permanently. This was a deliberate SDD decision (documented in the contract's own `@dev` comment) trading upgradeability for a smaller, easier-to-reason-about attack surface. |
| Revocation permanence | No code path clears `revoked` once set — enforced by absence of an un-revoke function, not by a guard. This matches the SRS requirement that revocation is a one-way lifecycle transition. |
| Zero-address checks | `registerIssuer` explicitly rejects `address(0)`. `deregisterIssuer` does not (deregistering the zero address is a harmless no-op since it was never `true`). |
| Data exposure | No personal data is stored on-chain anywhere — only a hash, an IPFS CID, addresses, timestamps, and a free-text revocation reason (which issuance-flow validation should keep free of PII; this is an off-chain input-hygiene concern, not a contract bug). |

## Known accepted risks (by design, not oversights)

1. **Custodian key custody is the real trust boundary.** Compromise of the backend's
   custodian private key is equivalent to compromising every issuer at once. Mitigated
   operationally (key stored outside the repo, `.env`-only, never logged) but there is
   no on-chain mitigation like a timelock or multisig for this testnet deployment —
   flagged as a pre-mainnet hardening item, not a bug to fix now.
2. **Single owner, no multisig.** Acceptable for a single-institution testnet pilot;
   would need `Ownable2Step` or a Safe multisig before any deployment where the owner
   key controls other people's trust anchors in production.
3. **No pausability / circuit breaker.** A deliberate minimalism tradeoff (fewer
   privileged functions = smaller attack surface) rather than an oversight — see the
   contract's own module-level `@dev` comment.

## Conclusion

No exploitable vulnerability was found in this review. The contract's small size and
zero-external-call design make most of the classic SWC categories structurally
inapplicable rather than merely mitigated. The open items above (multisig ownership,
key custody hardening) are correctly scoped as pre-mainnet work, not blockers for the
Polygon Amoy testnet deployment this project currently targets.

This is a self-review, not a professional audit, and should not be treated as one for
any deployment beyond testnet.
