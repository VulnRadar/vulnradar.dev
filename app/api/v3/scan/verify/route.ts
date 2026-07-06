import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { runAiVerification } from "@/lib/ai/verify-findings";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Sign in to use AI verification." },
      { status: 401 },
    );
  }

  let body: { scanHistoryId: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { scanHistoryId } = body;
  if (!scanHistoryId || typeof scanHistoryId !== "number") {
    return NextResponse.json(
      { error: "scanHistoryId is required." },
      { status: 400 },
    );
  }

  // Check user hasn't disabled AI
  try {
    const configResult = await pool.query(
      `SELECT ai_disabled FROM user_ai_configs WHERE user_id = $1`,
      [session.userId],
    );
    if (configResult.rows[0]?.ai_disabled) {
      return NextResponse.json(
        { error: "AI is disabled in your settings." },
        { status: 403 },
      );
    }
  } catch {
    /* no row = AI enabled by default */
  }

  // Fetch the scan — must belong to this user
  const scanResult = await pool.query(
    `SELECT url, findings FROM scan_history WHERE id = $1 AND user_id = $2`,
    [scanHistoryId, session.userId],
  );

  if (scanResult.rows.length === 0) {
    return NextResponse.json({ error: "Scan not found." }, { status: 404 });
  }

  const { url, findings } = scanResult.rows[0];
  const parsedFindings = Array.isArray(findings) ? findings : [];

  await runAiVerification(
    url as string,
    parsedFindings,
    scanHistoryId,
    session.userId,
  );

  // Return the updated findings
  const updated = await pool.query(
    `SELECT findings FROM scan_history WHERE id = $1`,
    [scanHistoryId],
  );

  return NextResponse.json({
    success: true,
    findings: updated.rows[0]?.findings ?? parsedFindings,
  });
}
