/**
 * Compiles the certificate PDF document. This is the ONE artifact whose bytes
 * get hashed and anchored on-chain, so identical input MUST always produce
 * byte-identical output — any variance (a live timestamp, random font
 * subsetting, non-deterministic object-stream ordering) would make the
 * on-chain hash unreproducible and re-verification would never match.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 792; // US Letter, landscape, points
const PAGE_HEIGHT = 612;
const CONTENT_MAX_WIDTH = PAGE_WIDTH - 140; // safe margin inside the border, room for a wrapped institution name

/** Greedily packs words into lines that each fit within `maxWidth` at `size`. */
const wrapText = (text, useFont, size, maxWidth) => {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (!currentLine || useFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
};

/**
 * Picks the largest font size (from a fixed, deterministic candidate list)
 * at which the institution name wraps to 3 lines or fewer within
 * `maxWidth` — a long name shrinks first, then wraps, rather than
 * overflowing the page border as a single oversized line.
 */
const fitInstitutionName = (text, useFont, maxWidth) => {
  const upper = text.toUpperCase();
  const candidateSizes = [22, 20, 18, 16, 14, 12];
  for (const size of candidateSizes) {
    const lines = wrapText(upper, useFont, size, maxWidth);
    if (lines.length <= 3) {
      return { lines, size };
    }
  }
  const size = candidateSizes[candidateSizes.length - 1];
  return { lines: wrapText(upper, useFont, size, maxWidth), size };
};

/**
 * Compiles a one-page certificate PDF.
 *
 * @param {object} input
 * @param {string} input.certificateNumber
 * @param {string} input.holderName
 * @param {string} input.title
 * @param {string} input.certificateType
 * @param {string} input.course
 * @param {string} [input.gradeOrResult]
 * @param {string} input.issueDate - ISO date string.
 * @param {string} input.institutionName
 * @param {string|Buffer} input.qrDataUrl - PNG data URL or raw PNG buffer for the verification QR code.
 * @param {object} [input.attributes]
 * @returns {Promise<{buffer: Buffer, templateVersion: number}>}
 * @throws {Error} If PDF compilation fails (wrapped as E_PDF_COMPILE_FAILED by the caller).
 */
export const compile = async (input) => {
  const {
    certificateNumber,
    holderName,
    title,
    certificateType,
    course,
    gradeOrResult,
    issueDate,
    institutionName,
    qrDataUrl,
  } = input;

  const doc = await PDFDocument.create();

  // DETERMINISM: DO NOT REMOVE — see pdf.adapter.test.js regression test.
  // Fixed producer/creator strings and a hardcoded constant date (never
  // `new Date()`/`Date.now()`) so that compiling the same input twice, at
  // any two points in time, yields byte-identical PDF bytes — required
  // because the compiled PDF's SHA-256 is the value anchored on-chain.
  const DETERMINISTIC_DATE = new Date('2024-01-01T00:00:00.000Z');
  doc.setProducer('SecureCred Certificate Engine');
  doc.setCreator('SecureCred Certificate Engine');
  doc.setCreationDate(DETERMINISTIC_DATE);
  doc.setModificationDate(DETERMINISTIC_DATE);
  doc.setTitle(`${title} — ${certificateNumber}`);
  doc.setAuthor(institutionName);
  doc.setSubject('SecureCred digital certificate');
  doc.setKeywords(['securecred', 'certificate', certificateNumber]);

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.1, 0.1, 0.12);
  const gray = rgb(0.4, 0.4, 0.42);
  const accent = rgb(0.02, 0.29, 0.55);

  const centerText = (text, y, size, useFont, color) => {
    const width = useFont.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (PAGE_WIDTH - width) / 2, y, size, font: useFont, color });
  };

  // Border
  page.drawRectangle({
    x: 24,
    y: 24,
    width: PAGE_WIDTH - 48,
    height: PAGE_HEIGHT - 48,
    borderColor: accent,
    borderWidth: 2,
  });

  const { lines: nameLines, size: nameSize } = fitInstitutionName(institutionName, boldFont, CONTENT_MAX_WIDTH);
  const nameLineHeight = nameSize * 1.25;
  let nameY = PAGE_HEIGHT - 90;
  for (const line of nameLines) {
    centerText(line, nameY, nameSize, boldFont, accent);
    nameY -= nameLineHeight;
  }
  // Every element below the name shifts down by however much extra height
  // the wrapped name took, so a long name never overlaps the next line —
  // a short (single-line) name leaves this at 0, i.e. the original layout.
  const nameBlockExtraHeight = (nameLines.length - 1) * nameLineHeight;

  centerText('CERTIFICATE OF ' + certificateType.replace(/_/g, ' '), PAGE_HEIGHT - 130 - nameBlockExtraHeight, 14, font, gray);

  centerText('This certifies that', PAGE_HEIGHT - 190 - nameBlockExtraHeight, 13, font, black);
  centerText(holderName, PAGE_HEIGHT - 225 - nameBlockExtraHeight, 26, boldFont, black);

  centerText('has been awarded', PAGE_HEIGHT - 260 - nameBlockExtraHeight, 13, font, black);
  centerText(title, PAGE_HEIGHT - 295 - nameBlockExtraHeight, 20, boldFont, black);

  centerText(`Programme: ${course}`, PAGE_HEIGHT - 330 - nameBlockExtraHeight, 12, font, black);

  let nextY = PAGE_HEIGHT - 352 - nameBlockExtraHeight;
  if (gradeOrResult) {
    centerText(`Grade / Result: ${gradeOrResult}`, nextY, 12, font, black);
    nextY -= 22;
  }

  centerText(`Issue date: ${issueDate}`, nextY, 12, font, black);
  nextY -= 22;

  centerText(`Certificate No: ${certificateNumber}`, nextY, 12, font, black);

  page.drawText('Verify at the SecureCred registry using the QR code or certificate number above.', {
    x: 60,
    y: 55,
    size: 8,
    font,
    color: gray,
  });

  if (qrDataUrl) {
    const qrBytes = typeof qrDataUrl === 'string'
      ? Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64')
      : qrDataUrl;
    const qrImage = await doc.embedPng(qrBytes);
    const qrSize = 110;
    page.drawImage(qrImage, {
      x: PAGE_WIDTH - 60 - qrSize,
      y: 55,
      width: qrSize,
      height: qrSize,
    });
  }

  const templateVersion = 1;

  const bytes = await doc.save({ useObjectStreams: false });
  return { buffer: Buffer.from(bytes), templateVersion };
};
