import { describe, it, expect } from '@jest/globals';
import { createHash } from 'node:crypto';
import { compile } from './pdf.adapter.js';

const SAMPLE_INPUT = {
  certificateNumber: 'SKIT-2026-ABCDEFGHJKMN',
  holderName: 'Asha Verma',
  title: 'Bachelor of Technology',
  certificateType: 'DEGREE',
  course: 'Computer Science & Engineering',
  gradeOrResult: 'First Class with Distinction',
  issueDate: '2026-05-20',
  institutionName: 'SKIT College of Engineering',
  // 1x1 transparent PNG, just to exercise the QR-embedding code path.
  qrDataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  attributes: {},
};

/**
 * DETERMINISM: DO NOT REMOVE — this is the regression test referenced by
 * pdf.adapter.js's module comment. If this test ever fails, the PDF adapter
 * has regressed to emitting non-deterministic bytes for identical input,
 * which would make the on-chain-anchored hash unreproducible.
 */
describe('pdf.adapter compile() determinism', () => {
  it('produces byte-identical output (and therefore an identical SHA-256) for identical input, across two separate calls', async () => {
    const first = await compile(SAMPLE_INPUT);
    const second = await compile(SAMPLE_INPUT);

    const hashOf = (buffer) => createHash('sha256').update(buffer).digest('hex');

    expect(first.buffer.equals(second.buffer)).toBe(true);
    expect(hashOf(first.buffer)).toBe(hashOf(second.buffer));
    expect(first.templateVersion).toBe(second.templateVersion);
  });

  it('produces different output for different input', async () => {
    const first = await compile(SAMPLE_INPUT);
    const second = await compile({ ...SAMPLE_INPUT, holderName: 'A Different Person' });
    expect(first.buffer.equals(second.buffer)).toBe(false);
  });

  it('returns a well-formed, non-trivial PDF buffer', async () => {
    const { buffer } = await compile(SAMPLE_INPUT);
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
  });
});
