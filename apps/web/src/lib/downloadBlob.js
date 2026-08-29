/**
 * Triggers a client-side file save from in-memory data, with no server
 * round-trip. Used for the verification "proof artifact" JSON download.
 */
export function downloadBlob(filename, content, mimeType = 'application/octet-stream') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
