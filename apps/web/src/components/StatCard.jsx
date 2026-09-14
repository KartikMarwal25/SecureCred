import { useInView } from '../hooks/useInView.js';
import { useCountUp } from '../hooks/useCountUp.js';

/**
 * An icon-badged stat tile with a number that counts up once it scrolls
 * into view. `value` must be a plain integer — format (e.g. "1,284,092")
 * is applied here via toLocaleString so callers never hand-format it.
 */
export function StatCard({ icon, label, value, suffix = '', tone = 'surface', className = '' }) {
  const [ref, isVisible] = useInView();
  const animated = useCountUp(value, { start: isVisible });

  const toneClasses =
    tone === 'brand'
      ? 'text-paper shadow-md [background-image:var(--gradient-brand)]'
      : 'border border-edge bg-paper text-ink shadow-xs';

  return (
    <div
      ref={ref}
      className={`flex flex-col gap-12 rounded-[16px] p-16 transition-shadow duration-300 hover:shadow-md sm:p-24 ${toneClasses} ${className}`}
    >
      {icon ? (
        <span
          className={`inline-flex h-40 w-40 items-center justify-center rounded-full ${
            tone === 'brand' ? 'bg-white/15' : 'bg-surface'
          }`}
        >
          {icon}
        </span>
      ) : null}
      <div>
        <p className="text-[28px] font-bold leading-[36px] tabular-nums sm:text-[32px]">
          {animated.toLocaleString()}
          {suffix}
        </p>
        <p
          className={`mt-4 text-[14px] font-bold uppercase leading-[20px] tracking-[0.4px] ${
            tone === 'brand' ? 'text-paper/75' : 'text-faint'
          }`}
        >
          {label}
        </p>
      </div>
    </div>
  );
}
