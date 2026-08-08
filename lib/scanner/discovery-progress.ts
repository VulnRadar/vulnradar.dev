/**
 * In-memory live-progress registry for POST /api/v3/scan/discover.
 *
 * Purely additive: the POST endpoint's request/response contract is
 * unchanged (its test suite asserts a synchronous, fully-resolved JSON
 * body), this just lets a concurrent GET poll watch the real stage
 * transitions of an in-flight discovery request. Keyed by a client-
 * generated requestId sent alongside the POST body.
 *
 * Per-process only, same tradeoff lib/scanner/scan-jobs.ts already makes
 * for cancellation flags -- VulnRadar runs as a single persistent Node
 * process (see app/api/v3/scan/route.ts), so this is not a durability gap
 * in practice, just a "won't survive a restart" limitation that doesn't
 * matter for a progress indicator watched live in one browser tab.
 */

export const DISCOVERY_STAGES = [
  "querying_sources",
  "brute_force",
  "dns_resolution",
  "reachability",
] as const;

export type DiscoveryStage = (typeof DISCOVERY_STAGES)[number] | "done";

interface DiscoveryProgressEntry {
  stage: DiscoveryStage;
}

/** How long a stale entry is kept before GC, in ms. */
const ENTRY_TTL_MS = 2 * 60 * 1000;

const progress = new Map<string, DiscoveryProgressEntry>();
const cleanupTimers = new Map<string, NodeJS.Timeout>();

export function setDiscoveryStage(
  requestId: string | undefined | null,
  stage: DiscoveryStage,
): void {
  if (!requestId) return;
  progress.set(requestId, { stage });

  const existing = cleanupTimers.get(requestId);
  if (existing) clearTimeout(existing);
  cleanupTimers.set(
    requestId,
    setTimeout(() => {
      progress.delete(requestId);
      cleanupTimers.delete(requestId);
    }, ENTRY_TTL_MS),
  );
}

export function getDiscoveryStage(requestId: string): DiscoveryStage | null {
  return progress.get(requestId)?.stage ?? null;
}
