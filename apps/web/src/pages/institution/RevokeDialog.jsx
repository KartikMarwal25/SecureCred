import { useEffect, useMemo, useRef, useState } from 'react';
import { revocationRequestSchema } from '@securecred/shared';
import { Modal } from '../../components/Modal.jsx';
import { Button } from '../../components/Button.jsx';
import { FieldError } from '../../components/FieldError.jsx';
import { revokeCertificate, ApiError } from '../../api/client.js';

const REASON_MAX = 160;

/**
 * The ONLY modal dialog in the whole product. Consequence stated first,
 * an alternative offered, identity restated, and the destructive action is
 * gated behind typing the certificate's exact identifier (not a checkbox).
 */
export function RevokeDialog({ isOpen, onClose, certificate, onRevoked }) {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    setReason('');
    setConfirmText('');
    setSubmitError(null);
    setSubmitting(false);
    requestAnimationFrame(() => cancelRef.current?.focus());
  }, [isOpen]);

  const reasonResult = useMemo(
    () => revocationRequestSchema.shape.reason.safeParse(reason),
    [reason],
  );
  const reasonError =
    reason.length > 0 && !reasonResult.success
      ? (reasonResult.error.issues[0]?.message ?? null)
      : null;
  const canSubmit =
    reasonResult.success && confirmText.trim() === certificate?.certificateNumber && !submitting;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit || !certificate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await revokeCertificate(certificate.certificateNumber, reason.trim());
      onRevoked();
    } catch (err) {
      setSubmitting(false);
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  if (!certificate) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} labelledBy="revoke-dialog-title">
      <form onSubmit={handleSubmit} className="flex flex-col gap-16">
        <h2 id="revoke-dialog-title" className="text-[18px] font-bold leading-[26px] text-bad">
          Revoke this certificate
        </h2>

        <p className="text-[16px] leading-[24px] text-body">
          This cannot be undone. No administrator can reverse a revocation, and every future
          verifier will be told.
        </p>
        <p className="text-[16px] leading-[24px] text-body">
          If this was issued in error, consider that a corrected credential can be issued
          separately.
        </p>

        <div className="rounded-[4px] border border-edge bg-surface p-12">
          <p className="font-mono text-[15px] leading-[22px] text-body">
            {certificate.certificateNumber}
          </p>
          <p className="text-[14px] leading-[20px] text-muted">
            {certificate.holderName} · {certificate.title}
          </p>
        </div>

        <div>
          <label
            htmlFor="revoke-reason"
            className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body"
          >
            Reason for revocation
          </label>
          <textarea
            id="revoke-reason"
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-invalid={reasonError ? 'true' : undefined}
            aria-describedby="revoke-reason-count revoke-reason-error"
            className={`mt-4 w-full rounded-[4px] border bg-paper px-12 py-8 text-[16px] leading-[24px] text-body ${
              reasonError ? 'border-bad' : 'border-edge-ctl'
            }`}
          />
          <p id="revoke-reason-count" className="mt-4 text-[14px] leading-[20px] text-faint">
            {reason.length}/{REASON_MAX} characters
          </p>
          <FieldError id="revoke-reason-error" message={reasonError} />
          <p className="mt-4 text-[14px] leading-[20px] text-warn">
            This reason is recorded on the blockchain permanently. Do not include personal
            details.
          </p>
        </div>

        <div>
          <label
            htmlFor="revoke-confirm"
            className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-body"
          >
            Type the certificate identifier to confirm
          </label>
          <input
            id="revoke-confirm"
            type="text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={certificate.certificateNumber}
            className="mt-4 w-full rounded-[4px] border border-edge-ctl bg-paper px-12 py-8 font-mono text-[15px] leading-[22px] text-body"
          />
        </div>

        <FieldError message={submitError} />

        <div className="flex flex-wrap gap-8">
          <Button type="button" variant="secondary" ref={cancelRef} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructiveFilled" disabled={!canSubmit}>
            Revoke permanently
          </Button>
        </div>
      </form>
    </Modal>
  );
}
