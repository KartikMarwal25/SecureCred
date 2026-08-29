import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { VERIFY_OUTCOME } from '@securecred/shared';
import { verifyCertificate, ApiError } from '../../api/client.js';
import { OutcomeBanner } from '../../components/OutcomeBanner.jsx';
import { ProofDisclaimer } from '../../components/ProofDisclaimer.jsx';
import { BlockchainProofPanel } from '../../components/BlockchainProofPanel.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';
import { Button } from '../../components/Button.jsx';

export function VerifyOutcomePage() {
  const { certificateNumber } = useParams();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const runVerify = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await verifyCertificate(certificateNumber);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiError ? err : new ApiError('Something went wrong.'));
    } finally {
      setLoading(false);
    }
  }, [certificateNumber]);

  useEffect(() => {
    runVerify();
  }, [runVerify]);

  const showProof =
    result &&
    (result.outcome === VERIFY_OUTCOME.VERIFIED || result.outcome === VERIFY_OUTCOME.REVOKED) &&
    result.txHash;

  return (
    <main className="mx-auto flex min-h-screen max-w-[560px] flex-col gap-24 px-12 py-32 sm:px-16 md:px-24">
      <div>
        <h1 className="text-[24px] font-bold leading-[32px] text-ink">Verification result</h1>
        <p className="mt-4 truncate font-mono text-[15px] leading-[22px] text-faint">
          {certificateNumber}
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col gap-16">
          <Skeleton className="h-[104px] w-full" />
          <Skeleton className="h-[96px] w-full" />
        </div>
      ) : error ? (
        <div className="rounded-[6px] border border-edge bg-neutral-bg p-16">
          <p className="text-[16px] leading-[24px] text-neutral">
            The verification service could not be reached. Check your connection and try again.
          </p>
          <Button variant="secondary" className="mt-16" onClick={runVerify}>
            Try again
          </Button>
        </div>
      ) : result ? (
        <>
          <OutcomeBanner result={result} />
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
    </main>
  );
}
