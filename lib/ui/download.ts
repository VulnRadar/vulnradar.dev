/**
 * Trigger a browser download of an in-memory Blob. Single source for the
 * fetch-blob-then-anchor recipe that was copy-pasted across the export menus.
 *
 * The anchor MUST be appended to the document before click(): a detached
 * `<a download>` does not reliably start a download in every browser (Firefox
 * in particular), which is why the two call sites that skipped the append
 * (settings export, 2FA backup-codes download) could silently no-op. Always
 * append, click, remove, and revoke the object URL.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** CSV-quote a value when it contains a comma, quote, or newline. */
export function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
