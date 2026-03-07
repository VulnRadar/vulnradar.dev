import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from "@/lib/constants"

export const GET = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  const result = await pool.query(
    `SELECT sh.id, sh.url, sh.summary, sh.findings_count, sh.duration, sh.scanned_at, sh.source,
       COALESCE(
         (SELECT json_agg(st.tag ORDER BY st.tag) FROM scan_tags st WHERE st.scan_id = sh.id AND st.user_id = $1),
         '[]'::json
       ) as tags
     FROM scan_history sh
     WHERE sh.user_id = $1
     ORDER BY sh.scanned_at DESC
     LIMIT 100`,
    [session.userId],
  )

  return ApiResponse.success({ scans: result.rows })
})

export const DELETE = withErrorHandling(async () => {
  const session = await getSession()
  if (!session) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  await pool.query("DELETE FROM scan_tags WHERE user_id = $1", [session.userId])
  await pool.query("DELETE FROM scan_history WHERE user_id = $1", [session.userId])

  return ApiResponse.success({ message: SUCCESS_MESSAGES.DELETED })
})
