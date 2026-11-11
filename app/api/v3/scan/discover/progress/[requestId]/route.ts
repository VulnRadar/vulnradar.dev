import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { parseBearer } from "@/lib/api/bearer";
import { authenticateApiKey } from "@/lib/api/api-key-auth";
import { API_KEY_SCOPES } from "@/lib/api/api-key-scopes";
import { withErrorHandling } from "@/lib/api/api-utils";
import { versioned } from "@/lib/api/v4/wrap";
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
async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const session = await getSession();
  if (!session) {
    if (parseBearer(request.headers.get("authorization")) === null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // scoping: reading progress of an in-flight discovery request is a
    // read, so it requires scan:read. The Terms check is new here and holds
    // on every version, like every other key-authenticated route's.
    const key = await authenticateApiKey(request, {
      scope: API_KEY_SCOPES.SCAN_READ,
    });
    if (!key.ok) return key.response;
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

export const GET = versioned(
  "scan.discoverProgress",
  withErrorHandling(handler),
);
