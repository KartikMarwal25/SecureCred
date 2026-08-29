const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-toolbox/network-helpers');

/**
 * Test suites map directly to the project's release-gating specs:
 *   TST-01: functional correctness (10 cases)
 *   TST-02: access control (8 cases)
 */
describe('SecureCredRegistry', function () {
  async function deployFixture() {
    const [owner, issuer, otherIssuer, stranger] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory('SecureCredRegistry');
    const registry = await Registry.deploy();

    // Register one issuer up front for tests that need a working issuer immediately.
    await registry.connect(owner).registerIssuer(issuer.address);

    return { registry, owner, issuer, otherIssuer, stranger };
  }

  function hashOf(label) {
    return ethers.keccak256(ethers.toUtf8Bytes(label));
  }

  const CID = 'bafybeigdyrztest1234567890abcdefghijklmnopqrstuvwxyz';

  describe('TST-01: functional correctness', function () {
    it('1. deploys with owner == deployer', async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      expect(await registry.owner()).to.equal(owner.address);
    });

    it('2. owner can registerIssuer, emits IssuerRegistered, isIssuer becomes true', async function () {
      const { registry, owner, otherIssuer } = await loadFixture(deployFixture);
      await expect(registry.connect(owner).registerIssuer(otherIssuer.address))
        .to.emit(registry, 'IssuerRegistered')
        .withArgs(otherIssuer.address);
      expect(await registry.isIssuer(otherIssuer.address)).to.equal(true);
    });

    it('3. anchorCertificate by a registered issuer succeeds and is observable via checkCertificate', async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const certHash = hashOf('certificate-1');
      const certRef = hashOf('ref-1');

      const tx = await registry.connect(issuer).anchorCertificate(certHash, CID, certRef);
      const block = await ethers.provider.getBlock(tx.blockNumber);

      await expect(tx)
        .to.emit(registry, 'CertificateAnchored')
        .withArgs(certHash, issuer.address, CID, block.timestamp, certRef);

      expect(await registry.totalAnchored()).to.equal(1n);

      const result = await registry.checkCertificate(certHash);
      expect(result.isIssued).to.equal(true);
      expect(result.isRevoked).to.equal(false);
      expect(result.issuer).to.equal(issuer.address);
      expect(result.ipfsCid).to.equal(CID);
    });

    it('4. anchoring the same certificateHash twice reverts with AlreadyAnchored', async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const certHash = hashOf('certificate-dup');
      const certRef = hashOf('ref-dup');

      await registry.connect(issuer).anchorCertificate(certHash, CID, certRef);

      await expect(
        registry.connect(issuer).anchorCertificate(certHash, CID, certRef)
      )
        .to.be.revertedWithCustomError(registry, 'AlreadyAnchored')
        .withArgs(certHash);
    });

    it('5. checkCertificate on a never-anchored hash returns isIssued=false and empty/zero fields', async function () {
      const { registry } = await loadFixture(deployFixture);
      const certHash = hashOf('never-anchored');

      const result = await registry.checkCertificate(certHash);
      expect(result.isIssued).to.equal(false);
      expect(result.isRevoked).to.equal(false);
      expect(result.issuer).to.equal(ethers.ZeroAddress);
      expect(result.issuedAt).to.equal(0n);
      expect(result.ipfsCid).to.equal('');
      expect(result.revocationReason).to.equal('');
    });

    it('6. revokeCertificate by the same issuer succeeds, emits event, and checkCertificate reflects it', async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const certHash = hashOf('certificate-revoke');
      const certRef = hashOf('ref-revoke');
      const reason = 'issued in error';

      await registry.connect(issuer).anchorCertificate(certHash, CID, certRef);

      const tx = await registry.connect(issuer).revokeCertificate(certHash, reason);
      const block = await ethers.provider.getBlock(tx.blockNumber);

      await expect(tx)
        .to.emit(registry, 'CertificateRevoked')
        .withArgs(certHash, issuer.address, reason, block.timestamp);

      const result = await registry.checkCertificate(certHash);
      expect(result.isRevoked).to.equal(true);
      expect(result.revocationReason).to.equal(reason);
    });

    it('7. revoking an unknown hash reverts with NotAnchored', async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const certHash = hashOf('unknown-hash');

      await expect(registry.connect(issuer).revokeCertificate(certHash, 'reason'))
        .to.be.revertedWithCustomError(registry, 'NotAnchored')
        .withArgs(certHash);
    });

    it('8. revoking an already-revoked hash reverts with AlreadyRevoked', async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const certHash = hashOf('certificate-double-revoke');
      const certRef = hashOf('ref-double-revoke');

      await registry.connect(issuer).anchorCertificate(certHash, CID, certRef);
      await registry.connect(issuer).revokeCertificate(certHash, 'first reason');

      await expect(registry.connect(issuer).revokeCertificate(certHash, 'second reason'))
        .to.be.revertedWithCustomError(registry, 'AlreadyRevoked')
        .withArgs(certHash);
    });

    it('9. anchoring with an empty ipfsCid reverts with EmptyCid', async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const certHash = hashOf('certificate-empty-cid');
      const certRef = hashOf('ref-empty-cid');

      await expect(
        registry.connect(issuer).anchorCertificate(certHash, '', certRef)
      ).to.be.revertedWithCustomError(registry, 'EmptyCid');
    });

    it('10. revoking with an empty reason reverts with EmptyReason', async function () {
      const { registry, issuer } = await loadFixture(deployFixture);
      const certHash = hashOf('certificate-empty-reason');
      const certRef = hashOf('ref-empty-reason');

      await registry.connect(issuer).anchorCertificate(certHash, CID, certRef);

      await expect(
        registry.connect(issuer).revokeCertificate(certHash, '')
      ).to.be.revertedWithCustomError(registry, 'EmptyReason');
    });
  });

  describe('TST-02: access control', function () {
    it('1. a non-owner calling registerIssuer reverts with NotOwner', async function () {
      const { registry, stranger, otherIssuer } = await loadFixture(deployFixture);
      await expect(
        registry.connect(stranger).registerIssuer(otherIssuer.address)
      ).to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('2. a non-owner calling deregisterIssuer reverts with NotOwner', async function () {
      const { registry, stranger, issuer } = await loadFixture(deployFixture);
      await expect(
        registry.connect(stranger).deregisterIssuer(issuer.address)
      ).to.be.revertedWithCustomError(registry, 'NotOwner');
    });

    it('3. registerIssuer(address(0)) reverts with ZeroAddress', async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      await expect(
        registry.connect(owner).registerIssuer(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(registry, 'ZeroAddress');
    });

    it('4. a non-registered address calling anchorCertificate reverts with NotIssuer', async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      const certHash = hashOf('access-control-anchor');
      const certRef = hashOf('access-control-anchor-ref');

      await expect(
        registry.connect(stranger).anchorCertificate(certHash, CID, certRef)
      )
        .to.be.revertedWithCustomError(registry, 'NotIssuer')
        .withArgs(stranger.address);
    });

    it('5. a non-registered address calling revokeCertificate reverts with NotIssuer', async function () {
      const { registry, stranger } = await loadFixture(deployFixture);
      const certHash = hashOf('access-control-revoke');

      await expect(
        registry.connect(stranger).revokeCertificate(certHash, 'reason')
      )
        .to.be.revertedWithCustomError(registry, 'NotIssuer')
        .withArgs(stranger.address);
    });

    it('6. after deregisterIssuer, that address can no longer anchor', async function () {
      const { registry, owner, issuer } = await loadFixture(deployFixture);
      const certHash = hashOf('deregistered-anchor');
      const certRef = hashOf('deregistered-anchor-ref');

      await registry.connect(owner).deregisterIssuer(issuer.address);

      await expect(
        registry.connect(issuer).anchorCertificate(certHash, CID, certRef)
      )
        .to.be.revertedWithCustomError(registry, 'NotIssuer')
        .withArgs(issuer.address);
    });

    it('7. owner cannot anchor/revoke unless separately registered as an issuer', async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      const certHash = hashOf('owner-not-issuer');
      const certRef = hashOf('owner-not-issuer-ref');

      // owner was never registered as an issuer in the fixture
      expect(await registry.isIssuer(owner.address)).to.equal(false);

      await expect(
        registry.connect(owner).anchorCertificate(certHash, CID, certRef)
      )
        .to.be.revertedWithCustomError(registry, 'NotIssuer')
        .withArgs(owner.address);

      await expect(
        registry.connect(owner).revokeCertificate(certHash, 'reason')
      )
        .to.be.revertedWithCustomError(registry, 'NotIssuer')
        .withArgs(owner.address);
    });

    it('8. deregistering the same address twice does not revert and issuer stays false', async function () {
      const { registry, owner, issuer } = await loadFixture(deployFixture);

      await registry.connect(owner).deregisterIssuer(issuer.address);
      expect(await registry.isIssuer(issuer.address)).to.equal(false);

      await expect(registry.connect(owner).deregisterIssuer(issuer.address)).to.not.be.reverted;
      expect(await registry.isIssuer(issuer.address)).to.equal(false);
    });
  });
});
