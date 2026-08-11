/**
 * SHA256SUMS.txt parsing + checksum verification. Pure functions, no
 * network or filesystem access, so these are unit-testable in isolation
 * (see tests/lib/updater/checksum.test.ts) -- this is the actual security
 * control for the self-update flow (see lib/updater/apply.ts), not an
 * afterthought, so it is kept small and easy to verify by reading it.
 */

import { createHash } from "node:crypto";

export interface ChecksumVerification {
  ok: boolean;
  expected?: string;
  actual?: string;
  error?: string;
}

/**
 * Parses a `sha256sum`-style checksums file: one entry per line, formatted
 * `<64 hex chars>  <filename>` (GNU coreutils uses two spaces, or one
 * space plus an optional leading "*" for binary mode; both are accepted).
 * Unrecognized lines are ignored rather than throwing, so a checksums file
 * with a trailing blank line or a comment doesn't break parsing.
 */
export function parseSha256Sums(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!match) continue;
    const [, hex, name] = match;
    map.set(name.trim(), hex.toLowerCase());
  }
  return map;
}

export function sha256Hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Verifies `fileBuffer` against the entry for `filename` inside a parsed
 * SHA256SUMS.txt. Fails closed: a missing entry, an unparsable checksums
 * file, or a mismatch are all `ok: false`.
 */
export function verifyChecksum(
  fileBuffer: Buffer,
  sha256sumsText: string,
  filename: string,
): ChecksumVerification {
  const sums = parseSha256Sums(sha256sumsText);
  const expected = sums.get(filename);
  if (!expected) {
    return {
      ok: false,
      error: `${filename} was not found in SHA256SUMS.txt.`,
    };
  }
  const actual = sha256Hex(fileBuffer);
  if (actual !== expected) {
    return {
      ok: false,
      expected,
      actual,
      error: `Checksum mismatch for ${filename}: expected ${expected}, got ${actual}.`,
    };
  }
  return { ok: true, expected, actual };
}
