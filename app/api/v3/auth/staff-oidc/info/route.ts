import { getStaffOidcConfig } from "@/lib/auth/staff-oidc";

export const runtime = "nodejs";

// Public, unauthenticated "tell the client what's configured" endpoint --
// same shape as /api/v3/auth/oauth/info. Never exposes the issuer URL or
// client id (neither is secret, but there's no reason to hand them to an
// unauthenticated caller either); the login page only needs a boolean to
// decide whether to render the "Sign in with SSO" link.
export async function GET() {
  const config = await getStaffOidcConfig();
  return Response.json({ configured: config !== null });
}
