import { NextRequest } from "next/server"
import { getSession } from "@/lib/auth"
import pool from "@/lib/db"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { ERROR_MESSAGES, SUCCESS_MESSAGES, BEARER_PREFIX } from "@/lib/constants"
import { validateApiKey } from "@/lib/api-keys"

export const GET = withErrorHandling(async (request: NextRequest) => {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization")
  let authedUserId: number | null = null

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7)
    const keyData = await validateApiKey(token)

    if (!keyData) {
      return ApiResponse.unauthorized("Invalid or revoked API key.")
    }
    authedUserId = keyData.userId
  } else {
    const session = await getSession()
    if (!session) {
      return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
    }
    authedUserId = session.userId
  }

  if (!authedUserId) {
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
    [authedUserId],
  )

  return ApiResponse.success({ scans: result.rows })
})

export const DELETE = withErrorHandling(async (request: NextRequest) => {
  // Auth: check API key first (Bearer token), then fall back to session cookie
  const authHeader = request.headers.get("authorization")
  let authedUserId: number | null = null

  if (authHeader?.startsWith(BEARER_PREFIX)) {
    const token = authHeader.slice(7)
    const keyData = await validateApiKey(token)

    if (!keyData) {
      return ApiResponse.unauthorized("Invalid or revoked API key.")
    }
    authedUserId = keyData.userId
  } else {
    const session = await getSession()
    if (!session) {
      return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
    }
    authedUserId = session.userId
  }

  if (!authedUserId) {
    return ApiResponse.unauthorized(ERROR_MESSAGES.UNAUTHORIZED)
  }

  await pool.query("DELETE FROM scan_tags WHERE user_id = $1", [authedUserId])
  await pool.query("DELETE FROM scan_history WHERE user_id = $1", [authedUserId])

  return ApiResponse.success({ message: SUCCESS_MESSAGES.DELETED })
})
