/** A loading placeholder — used instead of a bare spinner wherever content is pending. */
export function Skeleton({ className = '' }) {
  return <div className={`skeleton-shimmer rounded-[4px] ${className}`} aria-hidden="true" />;
}
