import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { VERIFY_OUTCOME } from '@securecred/shared';
import { verifyCertificate, verifyCertificateWithUpload, ApiError } from '../../api/client.js';
import { PublicHeader } from '../../components/PublicHeader.jsx';
import { PublicFooter } from '../../components/PublicFooter.jsx';
import { OutcomeBanner } from '../../components/OutcomeBanner.jsx';
import { ProofDisclaimer } from '../../components/ProofDisclaimer.jsx';
import { BlockchainProofPanel } from '../../components/BlockchainProofPanel.jsx';
import { CertificatePreviewPanel } from '../../components/CertificatePreviewPanel.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';
import { Button } from '../../components/Button.jsx';

export function VerifyOutcomePage() {
  const { certificateNumber } = useParams();
  const location = useLocation();
  // Set by VerifyEntryPage's "Upload document" tab, carried via router
  // navigation state (never the URL) — a File object survives history
  // state via the structured clone algorithm. Only meaningful on the
  // initial load of this page; a manual refresh loses it and falls back to
  // the ordinary IPFS-backed check, which is the only sane behavior since a
  // File can't be re-derived from a URL.
  const uploadedFile = location.state?.uploadFile ?? null;
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const runVerify = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = uploadedFile
        ? await verifyCertificateWithUpload(certificateNumber, uploadedFile)
        : await verifyCertificate(certificateNumber);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err : new ApiError('Something went wrong.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- uploadedFile is only ever read once, at mount, by design (see comment above)
  }, [certificateNumber]);

  useEffect(() => {
    runVerify();
  }, [runVerify]);

  const showProof =
    result &&
    (result.outcome === VERIFY_OUTCOME.VERIFIED || result.outcome === VERIFY_OUTCOME.REVOKED) &&
    result.txHash;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <PublicHeader />

      <main
        className="flex-1 px-12 py-32 sm:px-16 sm:py-48 md:px-24"
        style={{ backgroundImage: 'var(--gradient-hero)' }}
      >
        <div className="animate-fade-in-up mx-auto flex max-w-[560px] flex-col gap-24">
          <div>
            <h1 className="text-[24px] font-bold leading-[32px] text-ink">Verification result</h1>
            <p className="mt-4 truncate font-mono text-[15px] leading-[22px] text-faint">
              {certificateNumber}
            </p>
            {uploadedFile ? (
              <p className="mt-4 text-[14px] leading-[20px] text-faint">
                Checked against your uploaded file: <span className="font-bold text-body">{uploadedFile.name}</span>
              </p>
            ) : null}
          </div>

          {loading ? (
            <div className="flex flex-col gap-16">
              <Skeleton className="h-[104px] w-full rounded-[16px]" />
              <Skeleton className="h-[96px] w-full rounded-[16px]" />
            </div>
          ) : error ? (
            <div className="rounded-[16px] border border-edge bg-neutral-bg p-16 shadow-sm">
              <p className="text-[16px] leading-[24px] text-neutral">
                The verification service could not be reached. Check your connection and try
                again.
              </p>
              <Button variant="secondary" className="mt-16" onClick={runVerify}>
                Try again
              </Button>
            </div>
          ) : result ? (
            <>
              <OutcomeBanner result={result} />
              {result.certificate ? (
                <CertificatePreviewPanel
                  certificate={result.certificate}
                  certificateNumber={certificateNumber}
                />
              ) : null}
              <ProofDisclaimer />
              {showProof ? (
                <BlockchainProofPanel
                  certificateNumber={certificateNumber}
                  certificateHash={result.certificateHash}
                  ipfsCid={result.ipfsCid}
                  txHash={result.txHash}
                  blockNumber={result.blockNumber}
                  network={result.network}
                  outcome={result.outcome}
                />
              ) : null}
            </>
          ) : null}

          <p className="text-[14px] leading-[20px] text-faint">
            <Link to="/verify" className="font-bold text-brand">
              Verify another document
            </Link>
          </p>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
