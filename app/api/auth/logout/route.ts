import { destroySession } from "@/lib/auth"
import { ApiResponse, withErrorHandling } from "@/lib/api-utils"
import { SUCCESS_MESSAGES } from "@/lib/constants"

export const POST = withErrorHandling(async () => {
  await destroySession()
  return ApiResponse.success({ message: SUCCESS_MESSAGES.LOGOUT })
})
