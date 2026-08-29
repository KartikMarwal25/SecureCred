/**
 * Shared status-tone classes (StateChip and the verify outcome banner both
 * use these four tones — ok/warn/bad/neutral — mapped onto Tailwind classes
 * that resolve back to the design tokens in index.css).
 */
export const TONE_CLASSES = {
  ok: { bg: 'bg-ok-bg', text: 'text-ok', dot: 'bg-ok' },
  warn: { bg: 'bg-warn-bg', text: 'text-warn', dot: 'bg-warn' },
  bad: { bg: 'bg-bad-bg', text: 'text-bad', dot: 'bg-bad' },
  neutral: { bg: 'bg-neutral-bg', text: 'text-neutral', dot: 'bg-neutral' },
};
