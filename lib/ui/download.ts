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

/**
 * True for a cell Excel, LibreOffice or Sheets would hand to its formula
 * parser instead of showing as text. Quoting per RFC 4180 does NOT stop
 * this: the spreadsheet strips the quotes and evaluates what is inside, so
 * `=HYPERLINK(...)` or `+cmd|'/c calc'!A0` typed into a scan note, a page
 * title or a URL runs on the machine of whoever opens the export.
 *
 * A leading minus is only dangerous when it is not simply a negative
 * number, so `-3` and `-0.5` still export as numbers rather than text.
 */
function isFormulaCell(value: string): boolean {
  if (!/^[=+\-@\t\r]/.test(value)) return false;
  return !/^-?\d+(\.\d+)?$/.test(value);
}

/**
 * CSV-quote a value when it contains a comma, quote, or newline, and
 * neutralise spreadsheet formula injection by prefixing a single quote,
 * which every major spreadsheet reads as "the rest of this cell is text".
 */
export function escapeCsv(value: string): string {
  const cell = isFormulaCell(value) ? `'${value}` : value;
  if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}
