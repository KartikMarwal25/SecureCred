import { CERT_STATE } from '@securecred/shared';
import { TONE_CLASSES } from '../lib/tone.js';

/**
 * Word + dot, never color alone, covering all 7 CERT_STATE values.
 */
const STATE_CHIP_MAP = {
  [CERT_STATE.PENDING_STORAGE]: { label: 'In progress', tone: 'neutral' },
  [CERT_STATE.PENDING_ANCHOR]: { label: 'In progress', tone: 'neutral' },
  [CERT_STATE.ANCHORING]: { label: 'In progress', tone: 'neutral' },
  [CERT_STATE.ACTIVE]: { label: 'Active', tone: 'ok' },
  [CERT_STATE.REVOKING]: { label: 'Revoking', tone: 'warn' },
  [CERT_STATE.REVOKED]: { label: 'Revoked', tone: 'warn' },
  [CERT_STATE.FAILED]: { label: 'Failed', tone: 'bad' },
};

export function StateChip({ state, className = '' }) {
  const entry = STATE_CHIP_MAP[state] ?? { label: state ?? 'Unknown', tone: 'neutral' };
  const tone = TONE_CLASSES[entry.tone];
  return (
    <span
      className={`inline-flex items-center gap-8 rounded-full px-12 py-4 text-[12px] font-bold leading-[16px] tracking-[0.4px] ${tone.bg} ${tone.text} ${className}`}
    >
      <span className={`h-8 w-8 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
      {entry.label}
    </span>
  );
}
