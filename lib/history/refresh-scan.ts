import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import {
  resolveScanRow,
  type ScanHistoryRow,
} from "@/lib/history/resolve-scan";
import { userMeetsMinimumPlan } from "@/lib/billing/plan-limits";
import type { PlanId } from "@/lib/billing/catalog";

/**
 * Shared owner-resolution + result_meta merge for the per-scan "refresh this
 * capture" endpoints (DNS / ports / screenshot). These live here, not inside a
 * route file, because a Next.js route module may only export request handlers
 * -- a plain helper exported from a route breaks `next build`.
 *
 * Every refresh endpoint is an OWNER-only UI action: it re-runs one capture
 * for a scan the caller owns and updates that scan's result_meta in place. It
 * is deliberately session-only (no API-key path): these are dashboard/history
 * buttons, not a scripted-consumer surface, and the intrusive gates that
 * matter (browser-minutes for screenshots, verified-domain ownership for the
 * port sweep) are enforced by the individual routes.
 */

export type OwnedScanResult =
  | { ok: true; scan: ScanHistoryRow; userId: number }
  | { ok: false; response: NextResponse };

/**
 * Resolve the scan for a refresh request, requiring a logged-in owner. A
 * missing session is 401; a scan that does not exist OR is not owned by the
 * caller is the same 404 (anti-enumeration), matching every other per-scan
 * route in this codebase. Team members are intentionally not granted refresh:
 * re-running a metered/ownership-gated capture is an owner action.
 */
export async function resolveOwnedScan(id: string): Promise<OwnedScanResult> {
  const session = await getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const scan = await resolveScanRow(id);
  if (!scan || scan.user_id !== session.userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Scan not found" }, { status: 404 }),
    };
  }
  return { ok: true, scan, userId: session.userId };
}

/**
 * The plan a result-panel refresh (DNS / ports / screenshot) requires. Mirrors
 * the client-side gate PREMIUM_FEATURES.dns_refetch.requiredPlan in
 * components/modals/premium-upgrade-modal.tsx, so the server and the button
 * agree on the tier. Kept as a plain constant here rather than imported from
 * that client component (which pulls in Dialog/Link and cannot be loaded into
 * a server route).
 */
const REFRESH_MIN_PLAN: PlanId = "pro_supporter";

/**
 * Gate a refresh to a paid plan, matching the subdomain refresh's premium
 * gate. Returns ok when the caller's plan is high enough (or billing is
 * disabled entirely, i.e. self-hosted), otherwise a 402 with an upgrade
 * message. Call after resolveOwnedScan so it only ever runs for the owner.
 */
export async function requireRefreshPlan(
  userId: number,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const allowed = await userMeetsMinimumPlan(userId, REFRESH_MIN_PLAN);
  if (allowed) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      {
        error:
          "Refreshing this capture is a premium feature. Upgrade to Pro Supporter or higher to re-run it.",
        statusCode: "UPGRADE_REQUIRED",
      },
      { status: 402 },
    ),
  };
}

/**
 * Merge one or more keys into a scan's result_meta without clobbering the rest
 * (checksRun / dangerScore / the other captures). Scoped to the owner, same as
 * the AI-summary route's own merge.
 */
export async function mergeResultMeta(
  scanId: number,
  userId: number,
  patch: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `UPDATE scan_history
     SET result_meta = COALESCE(result_meta, '{}'::jsonb) || $1::jsonb
     WHERE id = $2 AND user_id = $3`,
    [JSON.stringify(patch), scanId, userId],
  );
}

/** Extract the hostname from a scan's stored URL, or null when unparseable. */
export function scanHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
