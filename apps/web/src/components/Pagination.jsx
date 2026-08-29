import { Button } from './Button.jsx';

/**
 * Note: the documented `GET /certificates` contract returns `{items, nextCursor}`
 * with no total count, so "of Z" is only shown when the API response happens
 * to include one; otherwise the range is shown without it rather than
 * fabricating a total.
 */
export function Pagination({ from, to, total, onPrev, onNext, hasPrev, hasNext }) {
  return (
    <div className="flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[14px] leading-[20px] text-faint">
        {total != null ? `Showing ${from}–${to} of ${total}` : `Showing ${from}–${to}`}
      </p>
      <div className="flex gap-8">
        <Button variant="secondary" onClick={onPrev} disabled={!hasPrev}>
          Previous
        </Button>
        <Button variant="secondary" onClick={onNext} disabled={!hasNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
