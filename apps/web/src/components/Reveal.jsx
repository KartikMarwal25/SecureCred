import { useInView } from '../hooks/useInView.js';

/**
 * Fades/slides a section in as it scrolls into view. Wrap any landing- or
 * dashboard-section-level block in this — not individual words/icons, that
 * would be noisy rather than polished.
 */
export function Reveal({
  as: Tag = 'div',
  delayMs = 0,
  threshold = 0.15,
  className = '',
  children,
  ...rest
}) {
  const [ref, isVisible] = useInView({ threshold });
  return (
    <Tag
      ref={ref}
      className={`reveal ${isVisible ? 'is-visible animate-fade-in-up' : ''} ${className}`}
      style={isVisible && delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
