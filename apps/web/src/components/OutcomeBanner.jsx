import { VERIFY_OUTCOME } from '@securecred/shared';
import { CheckIcon } from './icons/CheckIcon.jsx';
import { BarredCircleIcon } from './icons/BarredCircleIcon.jsx';
import { CrossIcon } from './icons/CrossIcon.jsx';
import { QuestionMarkIcon } from './icons/QuestionMarkIcon.jsx';
import { ClockIcon } from './icons/ClockIcon.jsx';
import { TONE_CLASSES } from '../lib/tone.js';
import { formatDate } from '../lib/formatDate.js';

const OUTCOME_CONFIG = {
  [VERIFY_OUTCOME.VERIFIED]: { word: 'VERIFIED', Icon: CheckIcon, tone: 'ok' },
  [VERIFY_OUTCOME.REVOKED]: { word: 'REVOKED', Icon: BarredCircleIcon, tone: 'warn' },
  [VERIFY_OUTCOME.TAMPERED]: { word: 'TAMPERED', Icon: CrossIcon, tone: 'bad' },
  [VERIFY_OUTCOME.NOT_FOUND]: { word: 'NOT FOUND', Icon: QuestionMarkIcon, tone: 'neutral' },
};

/**
 * Renders exactly one of the four public verification outcomes. Word + icon
 * + color always together — color is never the only signal. When the API
 * response has `degraded: true`, the panel hue is forced to neutral and a
 * "Not re-confirmed just now" band is shown, regardless of the underlying
 * outcome (this is a note on top of the outcome, not a fifth outcome).
 */
export function OutcomeBanner({ result }) {
  const { outcome, degraded, lastConfirmedAt, revocation } = result;
  const config = OUTCOME_CONFIG[outcome] ?? OUTCOME_CONFIG[VERIFY_OUTCOME.NOT_FOUND];
  const tone = degraded ? TONE_CLASSES.neutral : TONE_CLASSES[config.tone];
  const Icon = config.Icon;

  return (
    <div className={`rounded-[16px] border border-edge p-24 shadow-sm ${tone.bg}`}>
      <div className="flex flex-col items-center gap-16 text-center sm:flex-row sm:text-left">
        <span
          className={`animate-scale-in flex h-64 w-64 shrink-0 items-center justify-center rounded-full bg-paper ${tone.text}`}
        >
          <Icon className="h-32 w-32" />
        </span>
        <p className={`text-[24px] font-bold leading-[32px] tracking-[0.4px] ${tone.text}`}>
          {config.word}
        </p>
      </div>

      {outcome === VERIFY_OUTCOME.REVOKED && revocation ? (
        <p className="mt-16 text-[16px] leading-[24px] text-body">
          Revoked on {formatDate(revocation.revokedAt)}. Reason given: {revocation.reason}
        </p>
      ) : null}

      {outcome === VERIFY_OUTCOME.NOT_FOUND ? (
        <p className="mt-16 text-[16px] leading-[24px] text-body">
          This does not mean the document is fake.
        </p>
      ) : null}

      {degraded ? (
        <div className="mt-16 flex items-start gap-12 rounded-[8px] border border-edge bg-paper p-12">
          <ClockIcon className="mt-2 h-20 w-20 shrink-0 text-neutral" />
          <div>
            <p className="text-[16px] font-bold leading-[24px] text-ink">
              Not re-confirmed just now
            </p>
            <p className="mt-4 text-[14px] leading-[20px] text-faint">
              {lastConfirmedAt
                ? `This result is based on a check last confirmed on ${formatDate(lastConfirmedAt)}, not a live check just now.`
                : 'This result could not be re-confirmed against the blockchain just now.'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
