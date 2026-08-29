import { describe, it, expect } from '@jest/globals';
import { allocateCertificateNumber } from './certId.js';

const FORMAT = /^[A-Z0-9]{3,8}-\d{4}-[0-9A-HJKMNP-TV-Z]{12}$/;

describe('allocateCertificateNumber', () => {
  it('produces a string matching the certificate number format', () => {
    const number = allocateCertificateNumber('SKIT', 2026);
    expect(number).toMatch(FORMAT);
    expect(number.startsWith('SKIT-2026-')).toBe(true);
  });

  it('accepts a string issueYear', () => {
    const number = allocateCertificateNumber('ABC', '2024');
    expect(number).toMatch(FORMAT);
  });

  it('never emits the excluded Crockford characters I, L, O, U', () => {
    for (let i = 0; i < 200; i += 1) {
      const number = allocateCertificateNumber('SKIT', 2026);
      const suffix = number.split('-')[2];
      expect(suffix).not.toMatch(/[ILOU]/);
    }
  });

  it('is statistically unique across many calls', () => {
    const seen = new Set();
    const attempts = 5000;
    for (let i = 0; i < attempts; i += 1) {
      seen.add(allocateCertificateNumber('SKIT', 2026));
    }
    // With 12 chars from a 32-symbol alphabet, collisions across 5000 draws
    // should be effectively impossible; allow a tiny margin for safety.
    expect(seen.size).toBeGreaterThanOrEqual(attempts - 1);
  });

  it('throws for a malformed institution code', () => {
    expect(() => allocateCertificateNumber('sk', 2026)).toThrow(TypeError);
    expect(() => allocateCertificateNumber('toolonginstitution', 2026)).toThrow(TypeError);
    expect(() => allocateCertificateNumber(42, 2026)).toThrow(TypeError);
  });

  it('throws for a malformed issue year', () => {
    expect(() => allocateCertificateNumber('SKIT', 26)).toThrow(TypeError);
    expect(() => allocateCertificateNumber('SKIT', 'abcd')).toThrow(TypeError);
  });
});
