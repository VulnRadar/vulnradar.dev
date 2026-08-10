import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { listTrustedDevices } from "@/lib/auth/device-trust";
import { DEVICE_TRUST_COOKIE_NAME } from "@/lib/config/constants";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { summarizeUserAgent } from "@/lib/auth/user-agent-summary";

/**
 * List the caller's own trusted devices (created at 2FA login -- see
 * findTrustedDevice/upsertTrustedDevice in lib/auth/device-trust.ts).
 * Session-owner-only, always scoped to `session.userId`.
 *
 * `device_fingerprint` -- the value stored in the httpOnly
 * DEVICE_TRUST_COOKIE_NAME cookie that lets a device skip the 2FA prompt
 * -- is never included in the response. It's used only server-side here,
 * to mark which row is "this device" by comparing it against the
 * request's own cookie.
 */
export const GET = withErrorHandling(async () => {
  const session = await getSession();
  if (!session?.userId) {
    return ApiResponse.unauthorized();
  }

  const cookieStore = await cookies();
  const currentFingerprint = cookieStore.get(DEVICE_TRUST_COOKIE_NAME)?.value;

  const devices = await listTrustedDevices(session.userId);

  return NextResponse.json({
    devices: devices.map((d) => ({
      id: d.id,
      deviceName: d.device_name,
      ipAddress: d.ip_address,
      device: summarizeUserAgent(d.user_agent),
      createdAt: d.created_at,
      lastUsedAt: d.last_used_at,
      expiresAt: d.expires_at,
      isCurrent:
        !!currentFingerprint && d.device_fingerprint === currentFingerprint,
    })),
  });
});
