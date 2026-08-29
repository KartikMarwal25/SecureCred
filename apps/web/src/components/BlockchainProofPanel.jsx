import { CopyableValue } from './CopyableValue.jsx';
import { Button } from './Button.jsx';
import { downloadBlob } from '../lib/downloadBlob.js';

/**
 * VERIFIED/REVOKED only. This is a verifier-facing screen so it may use
 * technical terms (tx hash, IPFS, blockchain) freely — the language ban on
 * those words applies to student/verifier COPY that hides the mechanism,
 * not to this dedicated "how do I check the evidence" panel, which exists
 * specifically to name it.
 */
export function BlockchainProofPanel({ certificateNumber, certificateHash, ipfsCid, txHash, blockNumber, network, outcome }) {
  const handleDownloadProof = () => {
    const payload = {
      certificateNumber,
      certificateHash,
      ipfsCid,
      txHash,
      blockNumber,
      outcome,
    };
    downloadBlob(
      `securecred-proof-${certificateNumber}.json`,
      JSON.stringify(payload, null, 2),
      'application/json',
    );
  };

  return (
    <div className="rounded-[6px] border border-edge bg-paper p-16">
      <p className="text-[18px] font-bold leading-[26px] text-ink">Blockchain Proof</p>
      <div className="mt-16 flex flex-col gap-16">
        <CopyableValue
          label="Transaction hash"
          value={txHash}
          gloss="The unique reference for this record on the blockchain."
        />
        <CopyableValue
          label="IPFS CID"
          value={ipfsCid}
          gloss="The address of the stored document, independent of any single server."
        />
        <div>
          <p className="mb-4 text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
            Network
          </p>
          <p className="text-[16px] leading-[24px] text-body">{network || 'Polygon'}</p>
          <p className="mt-4 text-[14px] leading-[20px] text-faint">
            The blockchain network this record was recorded on.
          </p>
        </div>
      </div>
      <div className="mt-16">
        <Button variant="secondary" onClick={handleDownloadProof}>
          Download Proof Artifact (JSON)
        </Button>
      </div>
    </div>
  );
}
