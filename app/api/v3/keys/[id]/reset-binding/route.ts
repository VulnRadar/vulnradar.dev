import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { resetApiKeyBinding } from "@/lib/api/api-keys";
import { ERROR_MESSAGES } from "@/lib/config/constants";

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

  return NextResponse.json({ success: true });
}
