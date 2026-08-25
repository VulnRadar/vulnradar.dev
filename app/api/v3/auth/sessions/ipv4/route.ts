import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { isIP } from "node:net";
import { getSession } from "@/lib/auth";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/config/constants";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { verifyIpv4Token } from "@/lib/auth/ipv4-echo-token";
import pool from "@/lib/database/db";

/**
 * Record the IPv4 the echo endpoint (GET /api/v3/whoami-ip) observed onto the
 * caller's current session, so the security page can show a usable IPv4 next
 * to (or instead of) the IPv6 the app connection came in on.
 *
 * Same-origin and authenticated: the IPv4 is not taken from the request body
 * verbatim (that would be spoofable) but from the signed token the echo
 * endpoint minted after actually seeing the address. The stored value is
 * display-only and is never used for the session IP-binding check, which stays
 * keyed on the connection's real ip_address.
 */
export const POST = withErrorHandling(async (req: NextRequest) => {
  const session = await getSession();
  if (!session?.userId) return ApiResponse.unauthorized();

  const { token } = await req.json().catch(() => ({}));
  const ip = verifyIpv4Token(
    typeof token === "string" ? token : null,
    Date.now(),
  );
  if (!ip || isIP(ip) !== 4) {
    return ApiResponse.badRequest("Invalid or expired IPv4 token.");
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;
  if (!sessionId) return ApiResponse.unauthorized();

  await pool.query(
    "UPDATE sessions SET ipv4_address = $1 WHERE id = $2 AND user_id = $3",
    [ip, sessionId, session.userId],
  );

  return NextResponse.json({ success: true, ip });
});
