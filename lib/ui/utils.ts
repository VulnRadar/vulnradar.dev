import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Sanitize a value before using it as an anchor `href`, so a hostile or
 * malformed URL (a `javascript:`/`data:`/`vbscript:` scheme, most importantly)
 * can never execute when the link is clicked. Allows only http(s), mailto, tel,
 * and same-origin relative paths (including hash/query links); anything else
 * returns the `fallback` (default "#").
 *
 * Used wherever a URL that did not originate as a hardcoded literal reaches an
 * href: staff-authored notification action URLs and scanned/target URLs echoed
 * back into the UI. Defense-in-depth even where the value is server-validated.
 */
export function safeHref(url: unknown, fallback = "#"): string {
  if (typeof url !== "string") return fallback;
  const trimmed = url.trim();
  if (!trimmed) return fallback;
  // Relative paths (path, query, or hash) and protocol-relative-safe roots.
  // Reject "//host" (protocol-relative absolute) and "/\" tricks.
  if (/^[/?#]/.test(trimmed)) {
    if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
    return trimmed;
  }
  // Absolute URLs: allow only a known-safe scheme.
  const scheme = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1];
  if (!scheme) return trimmed; // no scheme and not root-relative (e.g. "example.com/x") -> treat as relative
  const allowed = ["http", "https", "mailto", "tel"];
  return allowed.includes(scheme.toLowerCase()) ? trimmed : fallback;
}
