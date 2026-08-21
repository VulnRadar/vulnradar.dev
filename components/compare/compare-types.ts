export interface ScanOption {
  id: number;
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

export interface ParsedUrl {
  subdomain: string | null;
  host: string;
  path: string;
  full: string;
}

export function parseUrl(url: string): ParsedUrl {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname + (u.search || "");
    const parts = u.hostname.split(".");
    // Treat as subdomain only if there are 3+ parts (e.g. sub.example.com)
    const subdomain = parts.length > 2 ? parts[0] : null;
    const host = subdomain ? parts.slice(1).join(".") : u.hostname;
    return { subdomain, host, path, full: u.hostname + path };
  } catch {
    return { subdomain: null, host: url, path: "", full: url };
  }
}

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
