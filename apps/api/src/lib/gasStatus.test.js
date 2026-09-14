import { describe, it, expect } from '@jest/globals';
import { classifyGasStatus, formatWeiToEther, getGasStatusSummary, GAS_STATUS_THRESHOLDS_WEI } from './gasStatus.js';

const ETHER = 10n ** 18n;

describe('classifyGasStatus', () => {
  it('classifies zero balance as critical', () => {
    expect(classifyGasStatus(0n)).toBe('critical');
  });

  it('classifies just under the critical threshold as critical', () => {
    expect(classifyGasStatus(GAS_STATUS_THRESHOLDS_WEI.critical - 1n)).toBe('critical');
  });

  it('classifies exactly the critical threshold as low (not critical)', () => {
    expect(classifyGasStatus(GAS_STATUS_THRESHOLDS_WEI.critical)).toBe('low');
  });

  it('classifies just under the low threshold as low', () => {
    expect(classifyGasStatus(GAS_STATUS_THRESHOLDS_WEI.low - 1n)).toBe('low');
  });

  it('classifies exactly the low threshold as healthy', () => {
    expect(classifyGasStatus(GAS_STATUS_THRESHOLDS_WEI.low)).toBe('healthy');
  });

  it('classifies a large balance as healthy', () => {
    expect(classifyGasStatus(9999n * ETHER)).toBe('healthy');
  });
});

describe('formatWeiToEther', () => {
  it('formats a whole-ether amount', () => {
    expect(formatWeiToEther(5n * ETHER)).toBe('5.0000');
  });

  it('formats a fractional amount, truncated (not rounded) to the requested decimals', () => {
    // 1.23456789 ether -> default 4 decimals -> truncates, doesn't round up
    expect(formatWeiToEther(1234567890000000000n)).toBe('1.2345');
  });

  it('formats zero', () => {
    expect(formatWeiToEther(0n)).toBe('0.0000');
  });

  it('respects a custom decimals argument', () => {
    expect(formatWeiToEther(1234567890000000000n, 2)).toBe('1.23');
  });

  it('stays exact for a balance too large to round-trip through a float safely', () => {
    // 2^53 + a fractional remainder — Number(bigint) would lose precision here.
    const huge = 9007199254740993n * ETHER + 500000000000000000n;
    expect(formatWeiToEther(huge)).toBe('9007199254740993.5000');
  });
});

describe('getGasStatusSummary', () => {
  it('combines status, formatted balance, and currency', () => {
    expect(getGasStatusSummary(50n * ETHER)).toEqual({
      gasStatus: 'healthy',
      balance: '50.0000',
      currency: 'POL',
    });
  });

  it('reports critical for a near-empty wallet', () => {
    expect(getGasStatusSummary(1000n)).toEqual({
      gasStatus: 'critical',
      balance: '0.0000',
      currency: 'POL',
    });
  });
});
