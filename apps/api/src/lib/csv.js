/**
 * Minimal, dependency-free CSV parser (RFC 4180 subset: quoted fields,
 * escaped `""` inside a quoted field, commas/newlines inside quotes, both
 * `\n` and `\r\n` line endings). Deliberately hand-written rather than a new
 * dependency — batch CSV issuance is the only consumer, and the format it
 * needs to handle is simple enough not to justify pulling in a parsing
 * library (and its own transitive dependency/attack surface) for it.
 */

/**
 * Parses CSV text into an array of row objects keyed by the header row.
 *
 * @param {string} text - Raw CSV content.
 * @returns {Array<Record<string, string>>} One object per data row (header row excluded).
 * @throws {Error} If the file is empty, or any data row has a different
 *   number of fields than the header row.
 */
export const parseCsv = (text) => {
  const rows = parseRows(text);
  if (rows.length === 0) {
    throw new Error('The CSV file is empty.');
  }
  const [header, ...dataRows] = rows;
  return dataRows.map((fields, i) => {
    if (fields.length !== header.length) {
      throw new Error(`Row ${i + 2} has ${fields.length} field(s), expected ${header.length} (matching the header row).`);
    }
    const record = {};
    header.forEach((key, j) => {
      record[key.trim()] = fields[j];
    });
    return record;
  });
};

/**
 * @param {string} text
 * @returns {string[][]} Every row (including the header), each an array of raw field strings.
 */
function parseRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // Skip a fully-empty trailing row (e.g. a trailing newline at EOF).
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      endRow();
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Final field/row if the text didn't end with a newline.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}
