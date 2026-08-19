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
