/**
 * Compact "how long ago" label for a capture timestamp, shared by the result
 * panels that show freshness (subdomain discovery, DNS records, port sweep).
 * Matches the wording SubdomainDiscovery introduced: "just now", "5 min ago",
 * "3 hours ago", "2 days ago". Returns null for a missing/unparseable
 * timestamp so the caller can fall back to a neutral label.
 */
export function formatAge(iso?: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Compact "time ago" label for list/table rows (history, assets, shares,
 * public-scans, teams, badges, compare, admin, the dashboard). Short form
 * ("just now", "5m ago", "3h ago", "2d ago") and, past a week, an absolute date
 * ("Aug 12", or "Aug 12, 2026" once it's a prior year). Accepts a string or a
 * Date so every caller can share it. The single source for this format --
 * previously ~10 near-identical copies had drifted (some read "0m ago" instead
 * of "just now", one never fell back to a date and read "92d ago" forever, and
 * the date fallback varied between "Aug 12" and "8/12/2026").
 */
export function formatRelativeTime(input: string | Date): string {
  const then =
    input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const d = new Date(then);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
  });
}

/**
 * Availability label for a refresh-capped panel (subdomain discovery, DNS
 * records, port sweep). Given the absolute time the next refresh becomes
 * available, reads "Available to refresh" once that moment has passed, or
 * "Available to refresh in 2h 10m" while still within the cap window. This
 * replaces the older "Refreshes in expired" phrasing, which read as broken the
 * moment the window elapsed. Returns null for a missing/unparseable timestamp.
 */
export function formatRefreshAvailability(
  readyAtIso?: string | null,
): string | null {
  if (!readyAtIso) return null;
  const readyAt = new Date(readyAtIso).getTime();
  if (Number.isNaN(readyAt)) return null;
  const remaining = readyAt - Date.now();
  if (remaining <= 0) return "Available to refresh";
  const mins = Math.floor(remaining / 60_000);
  if (mins < 1) return "Available to refresh in under a minute";
  if (mins < 60) return `Available to refresh in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0
    ? `Available to refresh in ${hours}h ${rem}m`
    : `Available to refresh in ${hours}h`;
}
