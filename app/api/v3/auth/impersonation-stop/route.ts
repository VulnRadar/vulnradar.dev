import { getSession } from "@/lib/auth";
import { stopImpersonation } from "@/lib/auth/impersonation";
import { logAction } from "@/lib/auth/authorization";
import { getClientIp } from "@/lib/api/request-utils";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES } from "@/lib/config/constants";

/**
 * POST /api/v3/auth/impersonation-stop
 *
 * Ends an active admin-impersonation session and restores the admin's own
 * session. Deliberately NOT gated by requireAdmin/requireStaff: while
 * impersonating, the session's own role is the impersonated user's role
 * (typically "user"), not the admin's -- stopImpersonation itself is what
 * verifies this session actually is an impersonation session (via
 * sessions.impersonated_by) before touching anything. Any signed-in
 * session can call this; a non-impersonation session gets a 400.
 */
export const POST = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);

  const impersonatedBy = session.impersonatedBy;
  const result = await stopImpersonation();
  if (!result.ok) {
    return ApiResponse.badRequest(result.error);
  }

  if (impersonatedBy) {
    const ip = (await getClientIp()) ?? undefined;
    await logAction(
      impersonatedBy,
      session.userId,
      "stop_impersonate",
      `Stopped impersonating ${session.email}`,
      ip,
    );
  }

  return ApiResponse.success({ message: "Impersonation ended." });
});
