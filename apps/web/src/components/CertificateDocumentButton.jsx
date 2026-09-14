import { useState } from 'react';
import { CERT_STATE } from '@securecred/shared';
import { fetchCertificateDocument, ApiError } from '../api/client.js';
import { Button } from './Button.jsx';

const DOWNLOADABLE_STATES = new Set([CERT_STATE.ACTIVE, CERT_STATE.REVOKED]);

/**
 * Fetches and opens a certificate's PDF in a new tab — never a plain
 * `<a href>`, so a failure shows a real error message here instead of the
 * browser navigating to the raw JSON error response. Disabled until the
 * certificate's anchoring (or revocation) is actually confirmed, since the
 * document genuinely isn't retrievable before then.
 */
export function CertificateDocumentButton({
  certificateNumber,
  status,
  label = 'View document',
  variant = 'secondary',
  className = '',
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isDownloadable = DOWNLOADABLE_STATES.has(status);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const blob = await fetchCertificateDocument(certificateNumber);
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      // The new tab needs the URL to stay valid while it loads the resource
      // (which happens asynchronously) — revoke well after that's done.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <Button variant={variant} className={className} onClick={handleClick} disabled={!isDownloadable || loading}>
        {loading ? 'Loading…' : label}
      </Button>
      {!isDownloadable ? (
        <p className="text-[13px] leading-[18px] text-faint">
          Available once this is confirmed on the blockchain.
        </p>
      ) : null}
      {error ? <p className="text-[14px] leading-[20px] text-bad">{error}</p> : null}
    </div>
  );
}
