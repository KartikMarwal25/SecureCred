export function LinkIcon({ className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 15l6-6" />
      <path d="M10 6.5l1-1a4 4 0 015.5 5.5l-1 1" />
      <path d="M14 17.5l-1 1a4 4 0 01-5.5-5.5l1-1" />
    </svg>
  );
}
