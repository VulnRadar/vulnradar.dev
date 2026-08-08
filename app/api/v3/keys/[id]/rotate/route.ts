import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { rotateApiKey, getUserApiKeys } from "@/lib/api/api-keys";
import { sendNotificationEmail } from "@/lib/notifications/notifications";
import { apiKeyCreatedEmail } from "@/lib/email/email";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { getClientIp, getUserAgent } from "@/lib/api/request-utils";
import { getUserPlanLimits } from "@/lib/billing/plan-limits";

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

  // Get key details before rotating
  const keys = await getUserApiKeys(session.userId);
  const keyToRotate = keys.find(
    (k: { id: number; revoked_at: string | null }) =>
      k.id === keyId && !k.revoked_at,
  );

  if (!keyToRotate) {
    return NextResponse.json(
      { error: "Key not found or already revoked" },
      { status: 404 },
    );
  }

  // billing: resolve the admin-configurable per-plan request quota (falls
  // back to unlimited when billing is off or the caller is staff), same
  // source of truth POST /api/v3/keys uses when a key is first created.
  const planLimits = await getUserPlanLimits(session.userId);
  const dailyLimit = planLimits ? planLimits.apiRequestsPerDay : -1;

  // Rotate the key
  const newKey = await rotateApiKey(
    keyId,
    session.userId,
    dailyLimit === -1 ? 999999 : dailyLimit,
  );
  if (!newKey) {
    return NextResponse.json(
      { error: "Failed to rotate key" },
      { status: 500 },
    );
  }

  // Send notification email
  const ip = (await getClientIp()) || "Unknown";
  const userAgent = (await getUserAgent()) || "Unknown";
  const emailContent = apiKeyCreatedEmail(newKey.name, newKey.key_prefix, {
    ipAddress: ip,
    userAgent,
  });

  sendNotificationEmail({
    userId: session.userId,
    userEmail: session.email,
    type: "api_keys",
    emailContent,
  }).catch((err) =>
    console.error("Failed to send API key rotated notification:", err),
  );

  return NextResponse.json({
    success: true,
    key: {
      id: newKey.id,
      key_prefix: newKey.key_prefix,
      name: newKey.name,
      daily_limit: newKey.daily_limit,
      created_at: newKey.created_at,
      raw_key: newKey.raw_key,
    },
  });
}
