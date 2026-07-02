import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { encryptApiKey, decryptApiKey } from "@/lib/auth/crypto";

// GET /api/v3/account/ai-config — return current AI config for the user
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await pool.query(
      `SELECT use_vulnradar_ai, provider, model_id, api_key_encrypted, base_url, updated_at
       FROM user_ai_configs WHERE user_id = $1`,
      [session.userId],
    );

    if (!result.rows[0]) {
      return NextResponse.json({ useVulnradarAi: true });
    }

    const row = result.rows[0];

    // Mask the API key: show only the last 4 characters
    let apiKeyMasked: string | null = null;
    if (row.api_key_encrypted) {
      try {
        const plain = decryptApiKey(row.api_key_encrypted);
        apiKeyMasked = plain.length > 4 ? plain.slice(-4) : plain;
      } catch {
        apiKeyMasked = null;
      }
    }

    return NextResponse.json({
      useVulnradarAi: row.use_vulnradar_ai,
      provider: row.provider ?? null,
      modelId: row.model_id ?? null,
      apiKeyLast4: apiKeyMasked,
      baseUrl: row.base_url ?? null,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error("AI config GET error:", error);
    return NextResponse.json(
      { error: "Failed to load AI config" },
      { status: 500 },
    );
  }
}

// PUT /api/v3/account/ai-config — save or update the user's AI config
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    useVulnradarAi?: boolean;
    provider?: string;
    modelId?: string;
    apiKey?: string;
    baseUrl?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const { useVulnradarAi, provider, modelId, apiKey, baseUrl } = body;

  if (useVulnradarAi === true) {
    // Switching back to VulnRadar AI — clear custom config
    try {
      await pool.query(
        `INSERT INTO user_ai_configs (user_id, use_vulnradar_ai, provider, model_id, api_key_encrypted, base_url, updated_at)
         VALUES ($1, TRUE, NULL, NULL, NULL, NULL, NOW())
         ON CONFLICT (user_id) DO UPDATE SET
           use_vulnradar_ai = TRUE,
           provider = NULL,
           model_id = NULL,
           api_key_encrypted = NULL,
           base_url = NULL,
           updated_at = NOW()`,
        [session.userId],
      );
      return NextResponse.json({ success: true, useVulnradarAi: true });
    } catch (error) {
      console.error("AI config PUT (reset) error:", error);
      return NextResponse.json(
        { error: "Failed to update AI config" },
        { status: 500 },
      );
    }
  }

  // Saving a custom provider config
  if (!provider || !modelId) {
    return NextResponse.json(
      { error: "provider and modelId are required when using a custom AI." },
      { status: 400 },
    );
  }

  try {
    // Look up the current encrypted key so we can keep it if no new key was provided
    const existing = await pool.query(
      `SELECT api_key_encrypted FROM user_ai_configs WHERE user_id = $1`,
      [session.userId],
    );

    let encryptedKey: string | null =
      existing.rows[0]?.api_key_encrypted ?? null;

    if (apiKey && apiKey.trim().length > 0) {
      encryptedKey = encryptApiKey(apiKey.trim());
    }

    if (!encryptedKey) {
      return NextResponse.json(
        { error: "An API key is required for custom AI providers." },
        { status: 400 },
      );
    }

    await pool.query(
      `INSERT INTO user_ai_configs (user_id, use_vulnradar_ai, provider, model_id, api_key_encrypted, base_url, updated_at)
       VALUES ($1, FALSE, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         use_vulnradar_ai = FALSE,
         provider = $2,
         model_id = $3,
         api_key_encrypted = $4,
         base_url = $5,
         updated_at = NOW()`,
      [session.userId, provider, modelId, encryptedKey, baseUrl ?? null],
    );

    return NextResponse.json({ success: true, useVulnradarAi: false });
  } catch (error) {
    console.error("AI config PUT error:", error);
    return NextResponse.json(
      { error: "Failed to save AI config" },
      { status: 500 },
    );
  }
}

// DELETE /api/v3/account/ai-config — reset to VulnRadar default
export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await pool.query(`DELETE FROM user_ai_configs WHERE user_id = $1`, [
      session.userId,
    ]);
    return NextResponse.json({ success: true, useVulnradarAi: true });
  } catch (error) {
    console.error("AI config DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to reset AI config" },
      { status: 500 },
    );
  }
}
