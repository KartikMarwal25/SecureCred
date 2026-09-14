import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * The ONLY modal dialog in the whole product (the revoke confirmation).
 * Traps focus, restores focus to the trigger on close, closes on Escape.
 * The full-viewport overlay is the one deliberate exception to "no
 * fixed-position elements" — a modal cannot function without it, and the
 * spec explicitly permits exactly one modal.
 */
export function Modal({ isOpen, onClose, labelledBy, children }) {
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = panelRef.current?.querySelectorAll(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-16">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="animate-scale-in max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[16px] border border-edge bg-paper p-24 shadow-[var(--shadow-dialog)]"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
