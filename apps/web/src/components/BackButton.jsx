import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon } from './icons/ArrowRightIcon.jsx';

/**
 * Goes back in browser history — i.e. wherever the user actually came from,
 * not a hardcoded parent route — so it stays correct regardless of how a
 * page was reached (in-app navigation, a bookmark, a shared link, etc).
 */
export function BackButton({ label = 'Back', className = '' }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      aria-label="Go back"
      className={`inline-flex min-h-[44px] min-w-[44px] items-center gap-8 text-[14px] font-bold leading-[20px] text-brand hover:underline ${className}`}
    >
      <ArrowRightIcon className="h-16 w-16 shrink-0 rotate-180" />
      {label ? <span>{label}</span> : null}
    </button>
  );
}
