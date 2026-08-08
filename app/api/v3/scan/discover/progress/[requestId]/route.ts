import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import {
  DISCOVERY_STAGES,
  getDiscoveryStage,
} from "@/lib/scanner/discovery-progress";

/**
 * Read-only peek at an in-flight POST /api/v3/scan/discover request's real
 * progress (see lib/scanner/discovery-progress.ts). Polled by the frontend
 * while the POST is still in flight; the POST's own response is unaffected
 * and remains the source of truth for the final result.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const session = await getSession();
  if (!session) {
    const authHeader = request.headers.get("authorization");
    const key = authHeader?.startsWith("Bearer ")
      ? await validateApiKey(authHeader.slice(7))
      : null;
    if (!key) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { requestId } = await params;
  const stage = getDiscoveryStage(requestId);
  const stageIndex =
    stage === "done"
      ? DISCOVERY_STAGES.length
      : stage
        ? Math.max(
            DISCOVERY_STAGES.indexOf(
              stage as (typeof DISCOVERY_STAGES)[number],
            ),
            0,
          )
        : 0;

  return NextResponse.json({
    stage: stage ?? "queued",
    stageIndex,
    stagesTotal: DISCOVERY_STAGES.length,
  });
}
