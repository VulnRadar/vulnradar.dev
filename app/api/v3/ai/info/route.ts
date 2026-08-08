import {
  resolveProviderName,
  resolveAiBaseUrl,
  resolveAiDefaultModel,
} from "@/lib/ai/provider";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";

export const runtime = "nodejs";

export async function GET() {
  const baseUrl = resolveAiBaseUrl();
  const configured = !!baseUrl && !!process.env.AI_API_KEY;

  let aiDisabled = false;
  try {
    const session = await getSession();
    if (session) {
      const result = await pool.query(
        `SELECT ai_disabled FROM user_ai_configs WHERE user_id = $1`,
        [session.userId],
      );
      aiDisabled = result.rows[0]?.ai_disabled ?? false;
    }
  } catch {
    /* non-fatal */
  }

  return Response.json({
    configured,
    model: resolveAiDefaultModel(baseUrl),
    provider: resolveProviderName(baseUrl),
    aiDisabled,
  });
}
