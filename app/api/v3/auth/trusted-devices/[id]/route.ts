import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeTrustedDevice } from "@/lib/auth/device-trust";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";

/**
 * Revoke one of the caller's own trusted devices, forcing that device to
 * pass 2FA again next time it signs in. `id` is the device_trust row's
 * numeric primary key (not the fingerprint/cookie value -- that's never
 * exposed to the client, see GET /api/v3/auth/trusted-devices).
 *
 * revokeTrustedDevice's WHERE id = $1 AND user_id = $2 enforces ownership
 * at the query level, so a device id belonging to another user can never
 * be deleted here -- it just returns 404, the same as an id that doesn't
 * exist at all. Exercised by
 * tests/app/api/v3/auth/trusted-devices/[id]/route.test.ts.
 */
export const DELETE = withErrorHandling(
  async (
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const session = await getSession();
    if (!session?.userId) {
      return ApiResponse.unauthorized();
    }

    const { id } = await params;
    const deviceId = Number.parseInt(id, 10);
    if (!Number.isInteger(deviceId)) {
      return ApiResponse.badRequest("Invalid device id");
    }

    const revoked = await revokeTrustedDevice(session.userId, deviceId);
    if (!revoked) {
      return ApiResponse.notFound("Trusted device not found");
    }

    return NextResponse.json({ success: true });
  },
);
