import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CERT_STATE } from '@securecred/shared';
import { getCertificate, ApiError } from '../../api/client.js';
import { useCertificateStatus } from '../../hooks/useCertificateStatus.js';
import { StateChip } from '../../components/StateChip.jsx';
import { LifecycleProgress } from '../../components/LifecycleProgress.jsx';
import { CopyableValue } from '../../components/CopyableValue.jsx';
import { CertificateDocumentButton } from '../../components/CertificateDocumentButton.jsx';
import { Button } from '../../components/Button.jsx';
import { Skeleton } from '../../components/Skeleton.jsx';
import { formatDate } from '../../lib/formatDate.js';
import { RevokeDialog } from './RevokeDialog.jsx';

const NON_TERMINAL_STATES = new Set([
  CERT_STATE.PENDING_STORAGE,
  CERT_STATE.PENDING_ANCHOR,
  CERT_STATE.ANCHORING,
  CERT_STATE.REVOKING,
]);

export function CertificateDetailPage() {
  const { id } = useParams();
  const [certificate, setCertificate] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const isNonTerminal = certificate ? NON_TERMINAL_STATES.has(certificate.status) : false;
  const { status: pollStatus, isPolling, timedOut, refresh } = useCertificateStatus(id, {
    enabled: isNonTerminal,
  });

  const loadCertificate = useCallback(async () => {
    try {
      const data = await getCertificate(id);
      setCertificate(data);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err : new ApiError('Could not load this certificate.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    loadCertificate();
  }, [loadCertificate]);

  // Once polling reports a different (further-along) state than the last
  // full fetch, re-fetch the full record so anchored-record fields
  // (block number, tx hash, IPFS reference) populate once ACTIVE.
  useEffect(() => {
    if (pollStatus && certificate && pollStatus.state !== certificate.status) {
      loadCertificate();
    }
  }, [pollStatus, certificate, loadCertificate]);

  const handleRetry = useCallback(() => {
    refresh();
    loadCertificate();
  }, [refresh, loadCertificate]);

  const handleRevoked = useCallback(() => {
    setRevokeOpen(false);
    loadCertificate();
  }, [loadCertificate]);

  const handleCopyLink = useCallback(async () => {
    if (!certificate) return;
    const link = `${window.location.origin}/verify/${certificate.certificateNumber}`;
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      // Clipboard access denied — nothing to recover, link stays visible elsewhere.
    }
  }, [certificate]);

  if (loading) {
    return (
      <div className="flex flex-col gap-16">
        <Skeleton className="h-[32px] w-2/3" />
        <Skeleton className="h-[120px] w-full rounded-[16px]" />
        <Skeleton className="h-[80px] w-full rounded-[16px]" />
      </div>
    );
  }

  if (loadError || !certificate) {
    return (
      <div className="rounded-[16px] border border-edge bg-neutral-bg p-16 shadow-xs">
        <p className="text-[16px] leading-[24px] text-neutral">
          This certificate could not be loaded. Check your connection and try again.
        </p>
        <Button variant="secondary" className="mt-16" onClick={loadCertificate}>
          Try again
        </Button>
      </div>
    );
  }

  const hasAnchoredRecord = Boolean(certificate.txHash);
  const currentState = pollStatus?.state ?? certificate.status;

  return (
    <div className="animate-fade-in-up flex flex-col gap-24">
      <div className="flex flex-col gap-8">
        <p className="font-mono text-[15px] leading-[22px] text-faint">
          {certificate.certificateNumber}
        </p>
        <div className="flex flex-wrap items-center gap-12">
          <h1 className="text-[24px] font-bold leading-[32px] text-ink">{certificate.holderName}</h1>
          <StateChip state={currentState} />
        </div>
        <p className="text-[16px] leading-[24px] text-muted">
          {certificate.title} · Issued {formatDate(certificate.issueDate)}
        </p>
      </div>

      <LifecycleProgress
        state={currentState}
        blockNumber={certificate.blockNumber}
        revokedAt={certificate.revocation?.revokedAt}
        onRetry={handleRetry}
      />

      {isPolling ? null : timedOut ? (
        <div className="rounded-[16px] border border-edge bg-surface p-16 shadow-xs">
          <p className="text-[14px] leading-[20px] text-faint">
            This is taking longer than usual. You can check again for an update.
          </p>
          <Button variant="secondary" className="mt-12" onClick={handleRetry}>
            Refresh
          </Button>
        </div>
      ) : null}

      {hasAnchoredRecord ? (
        <div className="rounded-[16px] border border-edge bg-paper p-16 shadow-sm sm:p-24">
          <p className="text-[18px] font-bold leading-[26px] text-ink">Anchored record</p>
          <dl className="mt-16 grid grid-cols-1 gap-16 md:grid-cols-2">
            <div>
              <dt className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                Institution
              </dt>
              <dd className="text-[16px] leading-[24px] text-body">
                {certificate.institutionName || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                Certificate title
              </dt>
              <dd className="text-[16px] leading-[24px] text-body">{certificate.title}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                Holder
              </dt>
              <dd className="text-[16px] leading-[24px] text-body">{certificate.holderName}</dd>
            </div>
            <div>
              <dt className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
                Date of issue
              </dt>
              <dd className="text-[16px] leading-[24px] text-body">
                {formatDate(certificate.issueDate)}
              </dd>
            </div>
          </dl>
          <div className="mt-16 flex flex-col gap-16">
            <CopyableValue
              label="Certificate fingerprint"
              value={certificate.certificateHash}
              gloss="A digital fingerprint of the exact document that was issued — even a single changed character would produce a different one."
            />
            <CopyableValue
              label="IPFS reference"
              value={certificate.ipfsCid}
              gloss="The address of the stored document on IPFS, independent of any single server."
            />
            <CopyableValue
              label="Transaction hash"
              value={certificate.txHash}
              gloss={`The blockchain transaction that recorded this certificate${certificate.blockNumber ? `, at block ${certificate.blockNumber}` : ''}.`}
            />
          </div>
        </div>
      ) : null}

      <div className="rounded-[16px] border border-edge bg-surface p-16 shadow-xs">
        <p className="text-[14px] leading-[20px] text-muted">
          Issued by {certificate.issuedBy || 'the registrar'} on {formatDate(certificate.issueDate)}
          {certificate.revocation
            ? ` · Revoked by ${certificate.revocation.revokedBy || 'the registrar'} on ${formatDate(certificate.revocation.revokedAt)}: ${certificate.revocation.reason}`
            : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-start gap-12">
        <CertificateDocumentButton
          certificateNumber={certificate.certificateNumber}
          status={currentState}
          label="Download"
        />
        <Button variant="secondary" onClick={handleCopyLink}>
          {linkCopied ? 'Copied' : 'Copy verification link'}
        </Button>
        {currentState === CERT_STATE.ACTIVE ? (
          <Button variant="destructive" className="ml-auto" onClick={() => setRevokeOpen(true)}>
            Revoke
          </Button>
        ) : null}
      </div>

      <RevokeDialog
        isOpen={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        certificate={certificate}
        onRevoked={handleRevoked}
      />
    </div>
  );
}
