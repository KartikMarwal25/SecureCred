import QRCode from 'qrcode';

/** Generates a PNG data URL for the given verification URL, client-side. */
export async function buildQrDataUrl(text) {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#15315b',
      light: '#ffffff',
    },
  });
}
