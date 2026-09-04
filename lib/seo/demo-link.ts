import { ROUTES } from "@/lib/config/client-constants";

/**
 * Longest target a CTA field will hand to /demo. A hostname is under 254
 * characters and a sane URL is under a few hundred; the cap is here so a
 * paste of an entire log file becomes a rejected input rather than a
 * multi-kilobyte query string.
 */
const MAX_TARGET_CHARS = 500;

/**
 * The /demo link for a target typed into an SEO page's call to action, or
 * null when there is nothing to scan.
 *
 * Deliberately does NOT validate or rewrite the target beyond trimming it.
 * /demo already prepends https:// when the scheme is missing, and the scan
 * API behind it enforces the scheme allowlist, the blocked-host list, the
 * DNS-rebinding guard and the per-IP rate limit. A second, weaker copy of
 * those rules here would only disagree with the real ones: this function's
 * whole job is to encode the value into a URL exactly once.
 */
export function demoScanHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_CHARS) return null;
  return `${ROUTES.DEMO}?url=${encodeURIComponent(trimmed)}`;
}
