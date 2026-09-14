import { Link } from 'react-router-dom';
import { CERT_STATE } from '@securecred/shared';
import { StateChip } from './StateChip.jsx';
import { buttonClassName } from './Button.jsx';
import { CertificateDocumentButton } from './CertificateDocumentButton.jsx';
import { formatDate } from '../lib/formatDate.js';
import { BuildingIcon } from './icons/BuildingIcon.jsx';

/**
 * A gallery card on the student "Your credentials" screen. The revoked
 * reason is shown directly on the card, never hidden behind another click.
 */
export function CredentialCard({ credential }) {
  const { certificateId, title, institutionName, issueDate, certificateNumber, status, revocation } =
    credential;

  return (
    <li className="animate-fade-in-up flex flex-col gap-12 rounded-[16px] border border-edge bg-paper p-16 shadow-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-md sm:p-24">
      <div className="flex flex-wrap items-start justify-between gap-12">
        <div className="flex min-w-0 items-start gap-12">
          <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-[8px] bg-surface text-brand">
            <BuildingIcon className="h-20 w-20" />
          </span>
          <div className="min-w-0">
            <p className="text-[18px] font-bold leading-[26px] text-ink">{title}</p>
            <p className="text-[14px] leading-[20px] text-muted">{institutionName}</p>
          </div>
        </div>
        <StateChip state={status} />
      </div>

      <div className="flex flex-wrap items-baseline gap-16 text-[14px] leading-[20px] text-faint">
        <span>{formatDate(issueDate)}</span>
        <span className="font-mono text-[15px] leading-[22px] text-body">{certificateNumber}</span>
      </div>

      {status === CERT_STATE.REVOKED && revocation ? (
        <p className="text-[14px] leading-[20px] text-warn">
          Revoked on {formatDate(revocation.revokedAt)}: {revocation.reason}
        </p>
      ) : null}

      {status === CERT_STATE.REVOKING ? (
        <p className="text-[14px] leading-[20px] text-faint">
          The revocation is being recorded on the blockchain.
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-8">
        <CertificateDocumentButton certificateNumber={certificateNumber} status={status} label="Download" />
        <Link to={`/me/credential/${certificateId}`} className={buttonClassName('secondary')}>
          Share
        </Link>
      </div>
    </li>
  );
}
