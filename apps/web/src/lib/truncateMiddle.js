/**
 * Truncates long hashes/CIDs/tx refs in the middle (e.g. "a1b2c3…f9e8d7")
 * so they never force horizontal page scroll. Never truncates at just one end.
 */
export function truncateMiddle(value, headLength = 6, tailLength = 6) {
  if (!value) return '';
  const str = String(value);
  if (str.length <= headLength + tailLength + 1) return str;
  return `${str.slice(0, headLength)}…${str.slice(-tailLength)}`;
}
