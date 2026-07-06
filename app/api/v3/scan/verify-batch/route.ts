import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validateApiKey } from "@/lib/api/api-keys";
import { BEARER_PREFIX } from "@/lib/config/constants";
import { verifyFindingsBatch } from "@/lib/ai/verify-findings";
import type { Vulnerability } from "@/lib/scanner/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  // Accept session auth OR API key auth
  let userId: number | null = null;

  const session = await getSession();
  if (session) {
    userId = session.userId;
  } else {
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith(BEARER_PREFIX)) {
      const key = authHeader.slice(BEARER_PREFIX.length);
      const keyResult = await validateApiKey(key);
      if (!keyResult) {
        return NextResponse.json(
          { error: "Invalid API key." },
          { status: 401 },
        );
      }
      userId = keyResult.userId;
    } else {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    }
  }

  let body: { url: string; findings: Vulnerability[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { url, findings } = body;
  if (!url || !Array.isArray(findings)) {
    return NextResponse.json(
      { error: "url and findings[] are required." },
      { status: 400 },
    );
  }

  const enriched = await verifyFindingsBatch(url, findings, userId);

  return NextResponse.json({ findings: enriched });
}
