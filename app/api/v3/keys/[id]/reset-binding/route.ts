import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { resetApiKeyBinding } from "@/lib/api/api-keys";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import pool from "@/lib/database/db";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { apiKeyBindingResetEmail } from "@/lib/email/email";

/**
 * Clear the IP a key pinned itself to on first use under
 * API_KEY_IP_BINDING_ENABLED. Rotating the key was previously the only way
 * out of a binding mismatch, which forces every consumer of that key to be
 * reconfigured for what is usually just "the CI runner got a different
 * address this morning" (AUDIT-011#drift-27).
 *
 * The next successful request re-adopts whichever subnet it comes from, so
 * this is a recovery action, not a way to disable the feature.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const { id } = await params;
  const keyId = parseInt(id, 10);
  if (isNaN(keyId)) {
    return NextResponse.json({ error: "Invalid key ID" }, { status: 400 });
  }

  const reset = await resetApiKeyBinding(keyId, session.userId);
  if (!reset) {
    return NextResponse.json(
      { error: "Key not found or already revoked" },
      { status: 404 },
    );
  }

  // A binding VIOLATION already emails (lib/api/api-keys.ts). Deliberately
  // switching the control off did not, which is the wrong way round: one is a
  // request that failed, the other is a security control being removed.
  void (async () => {
    try {
      const named = await pool.query<{ name: string }>(
        "SELECT name FROM api_keys WHERE id = $1 AND user_id = $2",
        [keyId, session.userId],
      );
      await sendNotificationEmail({
        userId: session.userId,
        userEmail: session.email,
        type: "api_keys",
        emailContent: apiKeyBindingResetEmail(
          named.rows?.[0]?.name ?? `Key #${keyId}`,
          {
            ipAddress: (await getClientIp()) || "Unknown",
            userAgent: await getUserAgent(),
          },
        ),
      });
    } catch (err) {
      console.error("Failed to send API key binding reset notice:", err);
    }
  })();

  return NextResponse.json({ success: true });
}
