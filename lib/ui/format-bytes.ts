/**
 * Format bytes to human-readable size. Shared by the admin backup panel and
 * the public /brand page, which is why it lives here and not in
 * components/admin.
 *
 * This used to be a second, wrong implementation with no callers: its unit
 * table stopped at "GB", so anything at or above 1 TB indexed past the end
 * and rendered "1 undefined". The body below is the one backup-manager.tsx
 * had defined privately and was the only one actually rendering bytes; it
 * handles TB and drops to 0 decimals at or above 10 of a unit. One export,
 * one behaviour.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
