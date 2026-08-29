/**
 * SecureCred never shows numeric-slash dates. Every date in the product is
 * rendered as "14 May 2027".
 */
const FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatDate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return FORMATTER.format(date);
}
