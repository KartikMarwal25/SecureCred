import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCertificate, ApiError } from '../../api/client.js';
import { buildQrDataUrl } from '../../lib/qr.js';
import { Skeleton } from '../../components/Skeleton.jsx';
import { Button } from '../../components/Button.jsx';

/**
 * Share panel: only the verification link and QR code live here. The PDF
 * download deliberately lives on the gallery card instead — never here.
 */
export function SharePanelPage() {
  const { id } = useParams();
  const [certificate, setCertificate] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCertificate(id)
      .then((data) => {
        if (cancelled) return;
        setCertificate(data);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err : new ApiError('Could not load this credential.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const verifyLink = certificate
    ? `${window.location.origin}/verify/${certificate.certificateNumber}`
    : '';

  useEffect(() => {
    if (!verifyLink) return undefined;
    let cancelled = false;
    buildQrDataUrl(verifyLink).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [verifyLink]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const handleCopy = useCallback(async () => {
    if (!verifyLink) return;
    try {
      await navigator.clipboard.writeText(verifyLink);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — the link remains visible and selectable.
    }
  }, [verifyLink]);

  const handleDownloadQr = useCallback(() => {
    if (!qrDataUrl || !certificate) return;
    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `securecred-${certificate.certificateNumber}-qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [qrDataUrl, certificate]);

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[480px] flex-col gap-16 px-12 py-32">
        <Skeleton className="h-[32px] w-2/3" />
        <Skeleton className="h-[200px] w-full" />
      </main>
    );
  }

  if (error || !certificate) {
    return (
      <main className="mx-auto flex min-h-screen max-w-[480px] flex-col gap-16 px-12 py-32">
        <p className="text-[16px] leading-[24px] text-neutral">
          This credential could not be loaded. Check your connection and try again.
        </p>
        <Link to="/me" className="font-bold text-brand">
          Back to your credentials
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[480px] flex-col gap-24 px-12 py-32">
      <div>
        <h1 className="text-[24px] font-bold leading-[32px] text-ink">Share this credential</h1>
        <p className="mt-8 text-[16px] leading-[24px] text-muted">{certificate.title}</p>
      </div>

      <div>
        <label
          htmlFor="share-link"
          className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body"
        >
          Verification link
        </label>
        <div className="mt-4 flex flex-col gap-8 sm:flex-row">
          <input
            id="share-link"
            type="text"
            readOnly
            value={verifyLink}
            onFocus={(event) => event.target.select()}
            className="min-h-[44px] flex-1 rounded-[4px] border border-edge-ctl bg-surface px-12 py-8 text-[16px] leading-[24px] text-body"
          />
          <Button variant="secondary" onClick={handleCopy}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-start gap-12">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="QR code linking to the verification page for this credential"
            className="h-[160px] w-[160px] rounded-[6px] border border-edge"
          />
        ) : (
          <Skeleton className="h-[160px] w-[160px]" />
        )}
        <Button variant="secondary" onClick={handleDownloadQr} disabled={!qrDataUrl}>
          Download the QR code
        </Button>
      </div>

      <p className="prose-copy text-[14px] leading-[20px] text-faint">
        Anyone with this link can confirm the credential is genuine. They cannot see your other
        credentials.
      </p>
      <p className="prose-copy text-[14px] leading-[20px] text-faint">
        If this credential is later revoked, the same link will show that the next time someone
        checks it.
      </p>

      <Link to="/me" className="font-bold text-brand">
        Back to your credentials
      </Link>
    </main>
  );
}
