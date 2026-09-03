export interface ScanOption {
  /**
   * scan_history.public_id, an opaque 32-char hex handle. NOT the numeric
   * primary key: GET /api/v3/history projects `sh.public_id AS id`. Typed
   * `number` once, which made the page parseInt it and send a value that
   * matched no scan, so every comparison failed.
   */
  id: string;
  url: string;
  findings_count: number;
  scanned_at: string;
  source?: string;
}

/** A host with 2+ scans on record, the only hosts a diff can be run against. */
export interface HostGroup {
  host: string;
  scans: ScanOption[];
}

export interface DiffResult {
  scanA: ScanOption & { summary: Record<string, number> };
  scanB: ScanOption & { summary: Record<string, number> };
  diff: {
    added: { title: string; severity: string }[];
    removed: { title: string; severity: string }[];
    unchanged: { title: string; severity: string }[];
    summary: { added: number; removed: number; unchanged: number };
  };
}

// Severity colors come from the canonical severityTone()/SEVERITY_TONE in
// components/scanner/severity-badge.tsx; the local copies here had drifted on
// `info` (bg-muted-foreground vs the --severity-info token).

// One splitter, in components/shared/url-display.tsx, alongside the component
// that renders the result. /compare and /badge each had their own copy and the
// two had already drifted apart in how they truncated the parts.
import { parseUrl, type ParsedUrl } from "@/components/shared/url-display";
export { parseUrl, type ParsedUrl };

export function displayUrl(url: string) {
  const { full } = parseUrl(url);
  return full;
}

export function getDomain(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function formatDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Canonical relative-time formatter (see lib/ui/relative-time.ts) -- fixes the
// old "0m ago" (no "just now" guard) this local copy produced.
export { formatRelativeTime as getRelativeTime } from "@/lib/ui/relative-time";
