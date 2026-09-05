import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  rotateApiKey,
  getUserApiKeys,
  UNLIMITED_API_KEY_DAILY_LIMIT,
} from "@/lib/api/api-keys";
import { ERROR_MESSAGES } from "@/lib/config/constants";
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
  // back to unlimited only when billing is off -- a staff caller now
  // resolves to the Pro Supporter plan's real limit), same source of
  // truth POST /api/v3/keys uses when a key is first created.
  const planLimits = await getUserPlanLimits(session.userId);
  const dailyLimit = planLimits ? planLimits.apiRequestsPerDay : -1;

  // Rotate the key. As at creation, this only refreshes the stored
  // snapshot in api_keys.daily_limit; enforcement resolves the owner's
  // current plan on every request now, so a rotation is no longer how a
  // plan change reaches the key.
  const newKey = await rotateApiKey(
    keyId,
    session.userId,
    dailyLimit === -1 ? UNLIMITED_API_KEY_DAILY_LIMIT : dailyLimit,
  );
  if (!newKey) {
    return NextResponse.json(
      { error: "Failed to rotate key" },
      { status: 500 },
    );
  }

  // Notification email (apiKeyRotationEmail, not apiKeyCreatedEmail -- a
  // rotation is not a first-time key creation) is now sent from inside
  // rotateApiKey() itself (lib/api/api-keys.ts), so every caller of that
  // function gets it consistently instead of only this route remembering to.

  return NextResponse.json({
    success: true,
    key: {
      id: newKey.id,
      key_prefix: newKey.key_prefix,
      name: newKey.name,
      daily_limit: newKey.daily_limit,
      created_at: newKey.created_at,
      raw_key: newKey.raw_key,
      scopes: newKey.scopes,
    },
  });
}
