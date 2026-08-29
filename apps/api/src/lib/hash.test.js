import { describe, it, expect } from '@jest/globals';
import { sha256Hex, toBytes32, fingerprintsEqual } from './hash.js';

describe('sha256Hex', () => {
  it('matches a known vector (empty buffer)', () => {
    expect(sha256Hex(Buffer.from(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches a known vector ("abc")', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('throws for non-buffer input', () => {
    expect(() => sha256Hex('not a buffer')).toThrow(TypeError);
  });
});

describe('toBytes32', () => {
  it('adds a 0x prefix to a 64-char hex string', () => {
    const hex = 'e'.repeat(64);
    expect(toBytes32(hex)).toBe(`0x${hex}`);
  });

  it('accepts an already 0x-prefixed string', () => {
    const hex = `0x${'a'.repeat(64)}`;
    expect(toBytes32(hex)).toBe(hex);
  });

  it('throws for malformed input', () => {
    expect(() => toBytes32('not-hex')).toThrow(TypeError);
    expect(() => toBytes32('ab')).toThrow(TypeError);
  });
});

describe('fingerprintsEqual', () => {
  it('returns true for identical digests', () => {
    const hash = sha256Hex(Buffer.from('hello world'));
    expect(fingerprintsEqual(hash, hash)).toBe(true);
  });

  it('returns true regardless of 0x prefix / case', () => {
    const hash = sha256Hex(Buffer.from('hello world'));
    expect(fingerprintsEqual(hash, `0x${hash.toUpperCase()}`)).toBe(true);
  });

  it('returns false for different digests', () => {
    const a = sha256Hex(Buffer.from('hello world'));
    const b = sha256Hex(Buffer.from('goodbye world'));
    expect(fingerprintsEqual(a, b)).toBe(false);
  });

  it('returns false for malformed input rather than throwing', () => {
    expect(fingerprintsEqual('not-hex', 'also-not-hex')).toBe(false);
    expect(fingerprintsEqual(null, undefined)).toBe(false);
  });
});
