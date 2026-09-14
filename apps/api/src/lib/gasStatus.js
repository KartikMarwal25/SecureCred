/**
 * Classifies the custodian wallet's native-token balance into a status an
 * institution admin can act on without needing to understand wei/gas units.
 * Pure function — no chain/network access here, so it's fully unit-testable;
 * the actual balance comes from chain.adapter.js's getCustodianBalance().
 */

const ONE_ETHER = 10n ** 18n;

// Thresholds are intentionally round, conservative numbers in the native
// token (POL on Polygon) rather than a precise "N certificates remaining"
// estimate — gas price moves with the market, so a hard certificate count
// would be more precise-looking than it actually is. CRITICAL means "an
// issuance could plausibly fail for lack of gas very soon"; LOW is an
// earlier warning with real runway left.
export const GAS_STATUS_THRESHOLDS_WEI = Object.freeze({
  critical: ONE_ETHER / 100n, // 0.01
  low: ONE_ETHER / 10n, // 0.1
});

/**
 * @param {bigint} balanceWei - The custodian wallet's current balance, in wei.
 * @returns {'critical'|'low'|'healthy'}
 */
export const classifyGasStatus = (balanceWei) => {
  if (balanceWei < GAS_STATUS_THRESHOLDS_WEI.critical) return 'critical';
  if (balanceWei < GAS_STATUS_THRESHOLDS_WEI.low) return 'low';
  return 'healthy';
};

/**
 * Formats a wei bigint as a decimal ether-unit string using integer
 * arithmetic throughout — never casts the bigint to `Number`, so this stays
 * exact even for very large balances (a float cast would silently lose
 * precision past 2^53).
 *
 * @param {bigint} wei
 * @param {number} [decimals] - Digits after the decimal point.
 * @returns {string}
 */
export const formatWeiToEther = (wei, decimals = 4) => {
  const whole = wei / ONE_ETHER;
  const remainder = wei % ONE_ETHER;
  const fractional = remainder.toString().padStart(18, '0').slice(0, decimals);
  return `${whole}.${fractional}`;
};

/**
 * `gasStatus`, not `status` — every route in this codebase wraps its
 * response in `{ status: 'ok', ...result }`; naming this field `status`
 * would silently collide with and overwrite that envelope when spread into
 * the response body.
 *
 * @param {bigint} balanceWei
 * @returns {{gasStatus: 'critical'|'low'|'healthy', balance: string, currency: 'POL'}}
 */
export const getGasStatusSummary = (balanceWei) => ({
  gasStatus: classifyGasStatus(balanceWei),
  balance: formatWeiToEther(balanceWei),
  currency: 'POL',
});
