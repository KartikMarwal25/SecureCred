import { CERT_STATE } from '@securecred/shared';
import { CheckIcon } from './icons/CheckIcon.jsx';
import { formatDate } from '../lib/formatDate.js';
import { Button } from './Button.jsx';

const STAGE_LABELS = [
  'Storing',
  'Recording · pending anchor',
  'Recording on blockchain',
  'Confirmed',
];

/**
 * Maps each CERT_STATE onto the 4-stage progress bar and its exact narrative
 * copy. REVOKING reuses the final ("Confirmed") slot to show the
 * revocation transaction in flight, since it is the only forward motion
 * possible after a certificate has already reached ACTIVE.
 */
function buildConfig(state, { blockNumber, revokedAt }) {
  switch (state) {
    case CERT_STATE.PENDING_STORAGE:
      return {
        activeIndex: 0,
        message: 'Storing the document. This usually takes a few seconds.',
        terminal: false,
      };
    case CERT_STATE.PENDING_ANCHOR:
      return {
        activeIndex: 1,
        message: 'Stored. Waiting to be recorded on the blockchain.',
        terminal: false,
      };
    case CERT_STATE.ANCHORING:
      return {
        activeIndex: 2,
        message:
          'Recording on the blockchain. This normally takes under a minute but can take longer when the network is busy.',
        terminal: false,
      };
    case CERT_STATE.ACTIVE:
      return {
        activeIndex: 3,
        message: `Confirmed on Polygon at block ${blockNumber ?? '—'}. The verification link and QR code are now live.`,
        terminal: true,
        finalComplete: true,
      };
    case CERT_STATE.REVOKING:
      return {
        activeIndex: 3,
        message: 'Recording the revocation on the blockchain.',
        terminal: false,
      };
    case CERT_STATE.REVOKED:
      return {
        activeIndex: 3,
        message: `Revoked on ${formatDate(revokedAt)}. This cannot be undone.`,
        terminal: true,
        finalComplete: true,
      };
    case CERT_STATE.FAILED:
      return {
        activeIndex: -1,
        message:
          'This could not be recorded on the blockchain after several attempts. Nothing was charged and nothing partial was published.',
        terminal: true,
        failed: true,
      };
    default:
      return { activeIndex: -1, message: '', terminal: true };
  }
}

function stageStatus(config, index) {
  if (config.failed) return 'queued';
  if (index < config.activeIndex) return 'complete';
  if (index === config.activeIndex) return config.finalComplete ? 'complete' : 'in-progress';
  return 'queued';
}

export function LifecycleProgress({ state, blockNumber, revokedAt, onRetry }) {
  const config = buildConfig(state, { blockNumber, revokedAt });

  return (
    <div className="rounded-[6px] border border-edge bg-surface p-16">
      <ol className="flex items-start gap-8">
        {STAGE_LABELS.map((label, index) => {
          const status = stageStatus(config, index);
          return (
            <li key={label} className="flex flex-1 flex-col items-center gap-8 text-center">
              <span
                className={`flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-2 ${
                  status === 'complete'
                    ? 'border-ok bg-ok text-paper'
                    : status === 'in-progress'
                      ? 'animate-pulse border-brand bg-brand text-paper'
                      : 'border-edge-ctl bg-paper text-faint'
                }`}
                aria-hidden="true"
              >
                {status === 'complete' ? <CheckIcon className="h-14 w-14" /> : null}
              </span>
              <span
                className={`text-[12px] font-bold leading-[16px] tracking-[0.4px] ${
                  status === 'queued' ? 'text-faint' : 'text-body'
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>

      <p
        className={`mt-16 text-[16px] leading-[24px] ${config.failed ? 'font-bold text-bad' : 'text-body'}`}
      >
        {config.message}
      </p>

      {!config.terminal ? (
        <p className="mt-8 text-[14px] leading-[20px] text-faint">
          You can leave this page — issuance continues without you.
        </p>
      ) : null}

      {config.failed ? (
        <div className="mt-16">
          <Button variant="secondary" onClick={onRetry}>
            Check again
          </Button>
        </div>
      ) : null}
    </div>
  );
}
