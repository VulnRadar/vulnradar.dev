import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { captureAndStoreScreenshot } from "@/lib/scanner/page-screenshot";
import { resolveOwnedScan, mergeResultMeta } from "@/lib/history/refresh-scan";

export const runtime = "nodejs";
// A real headless-browser capture: give it room above the capture's own
// internal wall-clock bound for session setup and teardown.
export const maxDuration = 60;

/**
 * POST /api/v3/history/[id]/screenshot
 *
 * Owner-only: re-capture the opt-in page screenshot for this scan and store
 * the fresh reference into result_meta.screenshot, returning it so the panel
 * reloads the image. Reuses captureAndStoreScreenshot, which self-gates the
 * same way the scan-time capture does: it re-validates the target (SSRF),
 * consumes the browser-minutes meter, respects the plan quota and the global
 * concurrency queue, and is best-effort -- any failure (unconfigured
 * BrowserBase, exhausted meter, timeout) returns null and we surface a 502
 * rather than overwriting the existing screenshot.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const owned = await resolveOwnedScan(id);
  if (!owned.ok) return owned.response;
  const { scan, userId } = owned;

  const rl = await checkRateLimit({
    key: `refresh-screenshot:${userId}`,
    ...RATE_LIMITS.scan,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Please wait before refreshing again." },
      { status: 429 },
    );
  }

  const screenshot = await captureAndStoreScreenshot(scan.id, scan.url, {
    userId,
    signal: AbortSignal.timeout(45_000),
  });
  if (!screenshot) {
    return NextResponse.json(
      {
        error:
          "Could not capture a screenshot. This needs a live browser session, which may be unavailable on your plan or once your live-browser minutes are used up.",
      },
      { status: 502 },
    );
  }

  await mergeResultMeta(scan.id, userId, { screenshot });
  return NextResponse.json({ screenshot });
}
