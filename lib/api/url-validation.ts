/**
 * Shared URL validators for the scan routes.
 *
 * Centralized so the bulk / crawl / discover / single-scan handlers
 * all enforce the same input limits. Without this, the routes
 * diverged in which checks they ran (see AUDIT-002#scanner-01) and a
 * 50 MB URL string slipped through to `validateScanTarget` + DB
 * INSERT.
 */
import { NextResponse } from "next/server";
import { SCANNING } from "@/lib/config/constants";

/**
 * Return a 400 response if `url` exceeds the configured per-URL length
 * cap, else null. Use as a guard at the top of every handler that
 * accepts a user-supplied URL.
 */
export function rejectOversizedUrl(url: unknown): NextResponse | null {
  if (typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }
  if (url.length > SCANNING.MAX_URL_LENGTH) {
    return NextResponse.json(
      {
        error: `URL exceeds maximum length of ${SCANNING.MAX_URL_LENGTH} characters.`,
      },
      { status: 400 },
    );
  }
  return null;
}
