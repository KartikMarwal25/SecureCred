/** A loading placeholder — used instead of a bare spinner wherever content is pending. */
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-[4px] bg-zebra ${className}`} aria-hidden="true" />;
}
