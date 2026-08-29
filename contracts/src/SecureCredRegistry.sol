// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @title SecureCredRegistry
/// @notice On-chain anchor for certificate fingerprints. Stores only the minimum
/// provable facts (hash, IPFS CID, issuer, timestamps, revocation flag/reason) —
/// never personal data. All state-changing calls are made by a single backend-held
/// "custodian wallet" on behalf of registered institutional issuers; there are no
/// end-user wallets in this system.
/// @dev Deliberately minimal and non-upgradeable: no proxy, no `delegatecall`, no
/// `selfdestruct`, no inline assembly, and no external calls of any kind. This keeps
/// the attack surface as small as possible for the single source of truth that every
/// off-chain verifier ultimately trusts.
contract SecureCredRegistry {
    /// @notice On-chain record for a single anchored certificate.
    /// @dev Field order is chosen for storage packing: `issuer` (20 bytes) packs into
    /// the same 32-byte slot as `issuedAt`, `revokedAt` (8 bytes each), `exists` and
    /// `revoked` (1 byte each) — 20 + 8 + 8 + 1 + 1 = 38 bytes still exceeds one slot,
    /// so the two `uint64` timestamps and two `bool` flags are grouped immediately
    /// after `issuer` so the EVM can pack as much of that group as possible into the
    /// slot following the address; the two `string` fields (`ipfsCid`,
    /// `revocationReason`) are dynamically sized and always occupy their own slot(s)
    /// regardless of ordering, so they are placed last.
    struct Record {
        address issuer;
        uint64 issuedAt;
        uint64 revokedAt;
        bool exists;
        bool revoked;
        string ipfsCid;
        string revocationReason;
    }

    /// @notice Address that deployed the contract and administers the issuer allowlist.
    address public owner;

    /// @notice Whether a given address is currently authorized to anchor/revoke certificates.
    mapping(address => bool) public isIssuer;

    /// @dev certificateHash => Record. Private storage; read only via `checkCertificate`.
    mapping(bytes32 => Record) private records;

    /// @notice Running count of certificates ever anchored (never decremented).
    uint256 public totalAnchored;

    error NotOwner();
    error NotIssuer(address account);
    error AlreadyAnchored(bytes32 certificateHash);
    error NotAnchored(bytes32 certificateHash);
    error AlreadyRevoked(bytes32 certificateHash);
    error EmptyCid();
    error EmptyReason();
    error ZeroAddress();

    /// @notice Emitted when a new certificate is anchored on-chain.
    /// @param certificateHash Keccak-256 fingerprint of the off-chain certificate payload.
    /// @param issuer Address (custodian-held, on behalf of an institution) that anchored it.
    /// @param ipfsCid Content identifier of the pinned certificate document/metadata.
    /// @param timestamp Block timestamp at anchoring.
    /// @param certificateRef Opaque off-chain reference (e.g. database record id) for correlation.
    event CertificateAnchored(
        bytes32 indexed certificateHash,
        address indexed issuer,
        string ipfsCid,
        uint256 timestamp,
        bytes32 certificateRef
    );

    /// @notice Emitted when an anchored certificate is revoked.
    /// @param certificateHash Keccak-256 fingerprint of the revoked certificate.
    /// @param issuer Address that performed the revocation.
    /// @param reason Human-readable revocation reason.
    /// @param timestamp Block timestamp at revocation.
    event CertificateRevoked(bytes32 indexed certificateHash, address indexed issuer, string reason, uint256 timestamp);

    /// @notice Emitted when an address is granted issuer status.
    event IssuerRegistered(address indexed issuer);

    /// @notice Emitted when an address has issuer status removed.
    event IssuerDeregistered(address indexed issuer);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyIssuer() {
        if (!isIssuer[msg.sender]) revert NotIssuer(msg.sender);
        _;
    }

    /// @notice Deploys the registry with `msg.sender` as the owner.
    /// @dev The owner is an administrative role only — it is NOT automatically an
    /// issuer. Anchoring/revoking requires separate, explicit `registerIssuer`.
    constructor() {
        owner = msg.sender;
    }

    /// @notice Grants issuer status to `issuer`, authorizing it to anchor and revoke certificates.
    /// @dev Owner-only. Reverts with `ZeroAddress` if `issuer` is the zero address.
    /// @param issuer Address to authorize.
    function registerIssuer(address issuer) external onlyOwner {
        if (issuer == address(0)) revert ZeroAddress();
        isIssuer[issuer] = true;
        emit IssuerRegistered(issuer);
    }

    /// @notice Revokes issuer status from `issuer`.
    /// @dev Owner-only. Idempotent: deregistering an address that is not currently an
    /// issuer simply leaves it as `false` and does not revert.
    /// @param issuer Address to deauthorize.
    function deregisterIssuer(address issuer) external onlyOwner {
        isIssuer[issuer] = false;
        emit IssuerDeregistered(issuer);
    }

    /// @notice Anchors a new certificate fingerprint on-chain.
    /// @dev Issuer-only. Follows checks-effects-interactions even though this contract
    /// makes no external calls at all (the entire reentrancy defense for this contract
    /// is that it never calls out to any other contract or address) — storage is
    /// written and `totalAnchored` incremented before the event is emitted, purely as
    /// a defensive coding convention. Reverts with `EmptyCid` if `ipfsCid` is empty, or
    /// `AlreadyAnchored` if `certificateHash` was already anchored.
    /// @param certificateHash Keccak-256 fingerprint of the off-chain certificate payload.
    /// @param ipfsCid Content identifier of the pinned certificate document/metadata.
    /// @param certificateRef Opaque off-chain reference (e.g. database record id) for correlation.
    function anchorCertificate(bytes32 certificateHash, string calldata ipfsCid, bytes32 certificateRef)
        external
        onlyIssuer
    {
        if (bytes(ipfsCid).length == 0) revert EmptyCid();
        if (records[certificateHash].exists) revert AlreadyAnchored(certificateHash);

        records[certificateHash] = Record({
            issuer: msg.sender,
            issuedAt: uint64(block.timestamp),
            revokedAt: 0,
            exists: true,
            revoked: false,
            ipfsCid: ipfsCid,
            revocationReason: ""
        });
        totalAnchored += 1;

        emit CertificateAnchored(certificateHash, msg.sender, ipfsCid, block.timestamp, certificateRef);
    }

    /// @notice Marks an already-anchored certificate as revoked, with a reason.
    /// @dev Issuer-only. There is no un-revoke / reinstate function anywhere in this
    /// contract — permanence of revocation is enforced by the absence of any code path
    /// that could clear `revoked`, not by a guard that could later be bypassed or
    /// upgraded away. Reverts with `NotAnchored` if the hash was never anchored,
    /// `AlreadyRevoked` if it was already revoked, or `EmptyReason` if `reason` is empty.
    /// @param certificateHash Keccak-256 fingerprint of the certificate to revoke.
    /// @param reason Human-readable revocation reason (e.g. "issued in error").
    function revokeCertificate(bytes32 certificateHash, string calldata reason) external onlyIssuer {
        Record storage record = records[certificateHash];
        if (!record.exists) revert NotAnchored(certificateHash);
        if (record.revoked) revert AlreadyRevoked(certificateHash);
        if (bytes(reason).length == 0) revert EmptyReason();

        record.revoked = true;
        record.revokedAt = uint64(block.timestamp);
        record.revocationReason = reason;

        emit CertificateRevoked(certificateHash, msg.sender, reason, block.timestamp);
    }

    /// @notice Looks up the on-chain status of a certificate hash.
    /// @dev Pure view over storage; never reverts. A `certificateHash` that was never
    /// anchored returns `isIssued == false` with all other fields zeroed/empty — public
    /// verifiers must be able to call this for ANY hash, including unknown ones, and
    /// treat `isIssued == false` as "not found" rather than relying on a revert.
    /// @param certificateHash Keccak-256 fingerprint to look up.
    /// @return isIssued True if this hash was ever anchored.
    /// @return isRevoked True if the anchored certificate has since been revoked.
    /// @return issuer Address that anchored the certificate (zero address if never anchored).
    /// @return issuedAt Block timestamp of anchoring (0 if never anchored).
    /// @return ipfsCid IPFS content identifier stored at anchoring (empty if never anchored).
    /// @return revocationReason Reason given at revocation (empty if not revoked or never anchored).
    function checkCertificate(bytes32 certificateHash)
        external
        view
        returns (
            bool isIssued,
            bool isRevoked,
            address issuer,
            uint64 issuedAt,
            string memory ipfsCid,
            string memory revocationReason
        )
    {
        Record storage record = records[certificateHash];
        return (record.exists, record.revoked, record.issuer, record.issuedAt, record.ipfsCid, record.revocationReason);
    }
}
