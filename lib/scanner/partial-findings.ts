/**
 * Findings a running scan has already turned up, as they arrive.
 *
 * The engine has reported these per completed category since progress
 * tracking landed (lib/scanner/scan-jobs.ts accumulates them into
 * `result_meta.partialFindings`), the status route returns them
 * (app/api/v3/scan/status/[id]/route.ts) and the OpenAPI spec documents
 * them. Nothing on the client declared the field, so through a three-minute
 * crawl the only thing on screen was "4 of 17 families complete" while the
 * server already knew the titles of what it had found.
 *
 * This module is the shared shape and the validator, so the poll loop
 * (app/dashboard/poll-scan-status.ts) and the progress card
 * (components/scanner/scanning-indicator.tsx) agree on it without the card
 * importing from app/.
 */

import type { Severity } from "@/lib/scanner/types";

/**
 * Severity plus title and nothing else, which is all the status route sends:
 * this is a live progress readout, not a result. The authoritative list is
 * `result.findings` on the completed response, and it can be SHORTER than
 * this one, because dedupe runs after the last category. Treat this as
 * "found so far" and let the completed result replace it wholesale.
 */
export interface PartialFinding {
  severity: Severity;
  title: string;
}

const VALID_SEVERITIES: ReadonlySet<string> = new Set<Severity>([
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

/** Titles are check-definition strings, but a finding's title can also come
 *  from an AI review of a third party's source, so it is bounded here rather
 *  than trusted to be short. */
const MAX_PARTIAL_TITLE_CHARS = 120;

/** Matches the status route's own MAX_PARTIAL_FINDINGS_SENT, so a payload
 *  that somehow grew past it cannot grow the progress card without bound. */
export const MAX_PARTIAL_FINDINGS = 40;

/**
 * Validate the partialFindings payload before anything renders it.
 *
 * The values are ours, but they have been through the database as JSON on a
 * row written by whatever engine version ran the scan, so the shape is
 * checked rather than asserted: an unknown severity is dropped instead of
 * indexing a tone table with it, and duplicate titles (the same issue found
 * in two families, before dedupe folds them together) collapse into one row.
 */
export function normalizePartialFindings(value: unknown): PartialFinding[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: PartialFinding[] = [];
  for (const entry of value) {
    if (out.length >= MAX_PARTIAL_FINDINGS) break;
    if (!entry || typeof entry !== "object") continue;
    const { severity, title } = entry as {
      severity?: unknown;
      title?: unknown;
    };
    if (typeof severity !== "string" || !VALID_SEVERITIES.has(severity)) {
      continue;
    }
    if (typeof title !== "string") continue;
    const trimmed = title.trim().slice(0, MAX_PARTIAL_TITLE_CHARS);
    if (!trimmed) continue;
    const key = `${severity}:${trimmed}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ severity: severity as Severity, title: trimmed });
  }
  return out;
}
