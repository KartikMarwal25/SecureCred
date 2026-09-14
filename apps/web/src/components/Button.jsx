export const BUTTON_VARIANT_CLASSES = {
  primary:
    'bg-brand text-paper border border-brand shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0',
  secondary:
    'bg-paper text-brand border border-edge-ctl hover:-translate-y-0.5 hover:bg-surface hover:shadow-sm active:translate-y-0',
  accent:
    'border border-transparent text-ink shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 [background-image:var(--gradient-accent)]',
  destructive: 'bg-paper text-bad border border-bad hover:bg-bad-bg',
  destructiveFilled: 'bg-bad text-paper border border-bad hover:opacity-90',
};

export const BUTTON_BASE_CLASSES =
  'inline-flex min-h-[44px] items-center justify-center gap-8 rounded-[8px] px-16 py-8 text-[16px] font-bold leading-[24px] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none';

/** For non-<button> elements (Link, <a download>) that must look like a Button. */
export function buttonClassName(variant = 'secondary', className = '') {
  return `${BUTTON_BASE_CLASSES} ${BUTTON_VARIANT_CLASSES[variant]} ${className}`;
}

/**
 * Buttons always name their action ("Issue credential", not "Submit") —
 * that's enforced at the call site, not here. This component only owns
 * sizing (>=44px hit target everywhere) and the four permitted visual
 * treatments.
 */
export function Button({
  variant = 'secondary',
  type = 'button',
  className = '',
  disabled = false,
  children,
  ref,
  ...rest
}) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={`${BUTTON_BASE_CLASSES} ${BUTTON_VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
