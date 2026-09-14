import { ShieldIcon } from './icons/ShieldIcon.jsx';

const SIZE_CLASSES = {
  sm: { icon: 'h-20 w-20', text: 'text-[16px]' },
  md: { icon: 'h-24 w-24', text: 'text-[18px]' },
  lg: { icon: 'h-28 w-28', text: 'text-[22px]' },
};

/**
 * The SecureCred wordmark, used identically across the public header, the
 * institution/student shells, and the footer so the brand mark never drifts
 * between pages.
 */
export function Logo({ size = 'md', tone = 'ink', className = '' }) {
  const { icon, text } = SIZE_CLASSES[size];
  const toneClass = tone === 'paper' ? 'text-paper' : 'text-ink';
  return (
    <span className={`inline-flex items-center gap-8 font-bold ${text} ${toneClass} ${className}`}>
      <ShieldIcon className={`${icon} shrink-0 text-brand ${tone === 'paper' ? 'text-accent' : ''}`} />
      SecureCred
    </span>
  );
}
