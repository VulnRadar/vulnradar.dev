/**
 * Shared helpers for detector functions.
 *
 * Extracted from lib/scanner/checks.ts so each per-category detector
 * file (planned: headers.ts, ssl.ts, content.ts, cookies.ts,
 * configuration.ts, information-disclosure.ts, dns.ts) can import
 * the same primitives without duplication.
 */

let idCounter = 0;
export function generateId(): string {
  return `vuln-${Date.now()}-${idCounter++}`;
}

export function getHeader(headers: Headers, key: string): string | null {
  return headers.get(key);
}

export function hasHeader(headers: Headers, key: string): boolean {
  return headers.has(key);
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type DetectFn = (
  url: string,
  headers: Headers,
  body: string,
) => string | null;
