import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyIcon } from './icons/CopyIcon.jsx';
import { CheckIcon } from './icons/CheckIcon.jsx';
import { truncateMiddle } from '../lib/truncateMiddle.js';

/**
 * A mono value with a copy control. Shows "Copied" inline in place of the
 * button label for a moment — this product uses no toasts anywhere, so the
 * confirmation has to live in the control itself.
 */
export function CopyableValue({ value, label, gloss, fullValueForCopy, truncate = true }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullValueForCopy ?? value);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser; nothing to recover here,
      // the value remains selectable as plain text.
    }
  }, [value, fullValueForCopy]);

  const displayValue = truncate ? truncateMiddle(value) : value;

  return (
    <div className="min-w-0">
      {label ? (
        <p className="mb-4 text-[12px] font-bold uppercase leading-[16px] tracking-[0.4px] text-faint">
          {label}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center gap-8">
        <code
          className="min-w-0 flex-1 truncate rounded-[4px] border border-edge bg-surface px-8 py-4 font-mono text-[15px] leading-[22px] text-body"
          title={fullValueForCopy ?? value}
        >
          {displayValue}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-4 rounded-[4px] border px-8 text-[14px] font-bold transition-colors duration-150 ${
            copied ? 'border-ok bg-ok-bg text-ok' : 'border-edge-ctl text-brand hover:bg-surface'
          }`}
          aria-label={`Copy ${label || 'value'}`}
        >
          {copied ? (
            <>
              <CheckIcon className="animate-scale-in h-16 w-16" />
              Copied
            </>
          ) : (
            <CopyIcon className="h-16 w-16" />
          )}
        </button>
      </div>
      {gloss ? <p className="mt-4 text-[14px] leading-[20px] text-faint">{gloss}</p> : null}
    </div>
  );
}
