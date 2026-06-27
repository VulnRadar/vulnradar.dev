import { getSession } from "@/lib/auth";
import pool from "@/lib/database/db";
import { ApiResponse, withErrorHandling } from "@/lib/api/api-utils";
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/config/constants";

export const POST = withErrorHandling(async () => {
  const session = await getSession();
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED);
  }

  await pool.query("UPDATE users SET tos_accepted_at = NOW() WHERE id = $1", [
    session.userId,
  ]);

  return ApiResponse.success({ message: SUCCESS_MESSAGES.SETTINGS_UPDATED });
});
