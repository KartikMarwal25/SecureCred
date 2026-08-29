import { Link } from 'react-router-dom';
import { CERT_STATE } from '@securecred/shared';
import { StateChip } from './StateChip.jsx';
import { buttonClassName } from './Button.jsx';
import { formatDate } from '../lib/formatDate.js';
import { getCertificateDocumentUrl } from '../api/client.js';

/**
 * A gallery card on the student "Your credentials" screen. The revoked
 * reason is shown directly on the card, never hidden behind another click.
 */
export function CredentialCard({ credential }) {
  const { certificateId, title, institutionName, issueDate, certificateNumber, status, revocation } =
    credential;
  const documentUrl = getCertificateDocumentUrl(certificateNumber);

  return (
    <li className="flex flex-col gap-12 rounded-[6px] border border-edge bg-paper p-16">
      <div className="flex flex-wrap items-start justify-between gap-8">
        <div className="min-w-0">
          <p className="text-[18px] font-bold leading-[26px] text-ink">{title}</p>
          <p className="text-[14px] leading-[20px] text-muted">{institutionName}</p>
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

      <div className="flex flex-wrap gap-8">
        <a href={documentUrl} className={buttonClassName('secondary')}>
          Download
        </a>
        <Link to={`/me/credential/${certificateId}`} className={buttonClassName('secondary')}>
          Share
        </Link>
      </div>
    </li>
  );
}
