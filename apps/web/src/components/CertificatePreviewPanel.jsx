import { BuildingIcon } from './icons/BuildingIcon.jsx';
import { CertificateDocumentButton } from './CertificateDocumentButton.jsx';
import { formatDate } from '../lib/formatDate.js';

/**
 * Shown only for VERIFIED/REVOKED outcomes — the certificate's own content,
 * not just proof-of-anchoring metadata. TAMPERED/NOT_FOUND never reach this
 * component, so there is nothing here to confuse with "the real thing."
 */
export function CertificatePreviewPanel({ certificate, certificateNumber }) {
  const { title, holderName, institutionName, issueDate, status } = certificate;

  return (
    <div className="rounded-[16px] border border-edge bg-paper p-16 shadow-sm sm:p-24">
      <div className="flex items-start gap-12">
        <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-[8px] bg-surface text-brand">
          <BuildingIcon className="h-20 w-20" />
        </span>
        <div className="min-w-0">
          <p className="text-[18px] font-bold leading-[26px] text-ink">{title}</p>
          <p className="text-[14px] leading-[20px] text-muted">{institutionName}</p>
        </div>
      </div>

      <div className="mt-16 flex flex-wrap items-baseline gap-x-24 gap-y-8 text-[14px] leading-[20px]">
        <div>
          <p className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
            Issued to
          </p>
          <p className="mt-2 text-[16px] leading-[24px] text-body">{holderName}</p>
        </div>
        <div>
          <p className="text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
            Issue date
          </p>
          <p className="mt-2 text-[16px] leading-[24px] text-body">{formatDate(issueDate)}</p>
        </div>
      </div>

      <div className="mt-16">
        <CertificateDocumentButton certificateNumber={certificateNumber} status={status} label="View document" />
      </div>
    </div>
  );
}
