import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiting/rate-limit";
import { captureAndStoreScreenshot } from "@/lib/scanner/page-screenshot";
import { checkBrowserbaseQuota } from "@/lib/billing/browserbase-usage";
import {
  resolveOwnedScan,
  requireRefreshPlan,
  mergeResultMeta,
} from "@/lib/history/refresh-scan";

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
 *
 * Premium-gated (requireRefreshPlan), matching the subdomain panel's refresh
 * control: on the hosted SaaS a re-capture is a paid feature, but a
 * self-hosted deployment (BILLING_ENABLED=false) allows it for everyone. On top
 * of that it checks the live-browser minute allowance up front so an exhausted
 * meter is a 402 that says so, rather than the generic 502 that a best-effort
 * capture would otherwise collapse into.
 *
 * This route both captures from cold and re-captures: the panel offers it on a
 * scan that was run without the screenshot option at all, which is why the UI
 * calls it "Capture screenshot" there and "Re-capture" once one exists.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const owned = await resolveOwnedScan(id);
  if (!owned.ok) return owned.response;
  const { scan, userId } = owned;

  const gate = await requireRefreshPlan(userId);
  if (!gate.ok) return gate.response;

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

  // Live-browser minutes, checked explicitly BEFORE the capture rather than
  // only inside it. capturePageScreenshot self-gates on the same meter, but it
  // is best-effort and collapses every reason into a null, so an owner whose
  // allowance was simply spent got the generic 502 below and no idea whether
  // waiting, upgrading, or buying credits was the answer. Same check and the
  // same 402 the interactive session route returns
  // (app/api/v3/browser/sessions/route.ts), so both spenders of this meter
  // refuse in the same words.
  const quota = await checkBrowserbaseQuota(userId);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error:
          quota.message ||
          "Your live-browser minutes for this period are used up, so a screenshot cannot be captured right now.",
        statusCode: "BROWSER_QUOTA_EXHAUSTED",
      },
      { status: 402 },
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
