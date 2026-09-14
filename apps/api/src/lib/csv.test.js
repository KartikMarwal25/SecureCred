import { describe, it, expect } from '@jest/globals';
import { parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('parses a simple CSV into row objects keyed by header', () => {
    const csv = 'holderName,enrollmentNumber\nAsha Verma,2023CSE001\nRahul Singh,2023CSE002';
    expect(parseCsv(csv)).toEqual([
      { holderName: 'Asha Verma', enrollmentNumber: '2023CSE001' },
      { holderName: 'Rahul Singh', enrollmentNumber: '2023CSE002' },
    ]);
  });

  it('handles CRLF line endings', () => {
    const csv = 'a,b\r\n1,2\r\n3,4';
    expect(parseCsv(csv)).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('handles a quoted field containing a comma', () => {
    const csv = 'title,note\n"B.Tech, Computer Science",fine\nPlain,ok';
    expect(parseCsv(csv)).toEqual([
      { title: 'B.Tech, Computer Science', note: 'fine' },
      { title: 'Plain', note: 'ok' },
    ]);
  });

  it('handles an escaped double-quote inside a quoted field', () => {
    const csv = 'note\n"She said ""hello"""';
    expect(parseCsv(csv)).toEqual([{ note: 'She said "hello"' }]);
  });

  it('handles a quoted field containing a newline', () => {
    const csv = 'a,b\n"line1\nline2",x';
    expect(parseCsv(csv)).toEqual([{ a: 'line1\nline2', b: 'x' }]);
  });

  it('ignores a trailing blank line at end of file', () => {
    const csv = 'a,b\n1,2\n';
    expect(parseCsv(csv)).toEqual([{ a: '1', b: '2' }]);
  });

  it('trims header whitespace but preserves field value whitespace', () => {
    const csv = ' a , b \n 1 , 2 ';
    expect(parseCsv(csv)).toEqual([{ a: ' 1 ', b: ' 2 ' }]);
  });

  it('throws on an empty file', () => {
    expect(() => parseCsv('')).toThrow('empty');
  });

  it('throws when a data row has the wrong number of fields', () => {
    const csv = 'a,b,c\n1,2';
    expect(() => parseCsv(csv)).toThrow('Row 2 has 2 field(s), expected 3');
  });

  it('handles a header-only file (zero data rows) without throwing', () => {
    expect(parseCsv('a,b')).toEqual([]);
  });
});
