import { NextResponse } from "next/server"
import { getSession } from "./auth"
import pool from "./db"
import { ERROR_MESSAGES } from "./constants"

/**
 * Standard API response helpers to reduce boilerplate across routes
 */

export interface ApiErrorResponse {
  error: string
}

export interface ApiSuccessResponse<T> {
  data?: T
  message?: string
  [key: string]: any
}

/**
 * JSON response helpers
 */
export const ApiResponse = {
  success: <T,>(data: T, status = 200) =>
    NextResponse.json(data, { status }),

  error: (message: string, status = 400) =>
    NextResponse.json({ error: message }, { status }),

  badRequest: (message = ERROR_MESSAGES.UNAUTHORIZED || "Bad request") =>
    NextResponse.json({ error: message }, { status: 400 }),

  unauthorized: (message = ERROR_MESSAGES.UNAUTHORIZED) =>
    NextResponse.json({ error: message }, { status: 401 }),

  forbidden: (message = ERROR_MESSAGES.FORBIDDEN) =>
    NextResponse.json({ error: message }, { status: 403 }),

  notFound: (message = ERROR_MESSAGES.NOT_FOUND) =>
    NextResponse.json({ error: message }, { status: 404 }),

  conflict: (message = "Conflict") =>
    NextResponse.json({ error: message }, { status: 409 }),

  tooManyRequests: (message = "Too many requests", retryAfter?: number) => {
    const response = NextResponse.json({ error: message }, { status: 429 })
    if (retryAfter) {
      response.headers.set("Retry-After", String(retryAfter))
    }
    return response
  },

  serverError: (message = ERROR_MESSAGES.SERVER_ERROR) =>
    NextResponse.json({ error: message }, { status: 500 }),
}

/**
 * Authentication guard for protected routes
 */
export async function requireAuth() {
  const session = await getSession()
  if (!session) {
    return {
      authorized: false,
      error: ApiResponse.unauthorized("Authentication required"),
      session: null,
    }
  }

  // Check if account is disabled
  const userCheck = await pool.query(
    "SELECT disabled_at FROM users WHERE id = $1",
    [session.userId],
  )
  if (userCheck.rows[0]?.disabled_at) {
    return {
      authorized: false,
      error: ApiResponse.forbidden(ERROR_MESSAGES.ACCOUNT_DISABLED),
      session: null,
    }
  }

  return {
    authorized: true,
    error: null,
    session,
  }
}

/**
 * Validation helpers
 */
export const Validate = {
  required: (value: any, fieldName: string) => {
    if (!value) {
      return `${fieldName} is required`
    }
    return null
  },

  email: (email: string) => {
    if (typeof email !== "string" || !email.includes("@")) {
      return "Please enter a valid email address"
    }
    return null
  },

  password: (password: string, minLength = 8) => {
    if (typeof password !== "string" || password.length < minLength) {
      return `Password must be at least ${minLength} characters`
    }
    return null
  },

  string: (value: any, fieldName: string, minLength = 1, maxLength?: number) => {
    if (typeof value !== "string" || value.trim().length < minLength) {
      return `${fieldName} must be at least ${minLength} characters`
    }
    if (maxLength && value.trim().length > maxLength) {
      return `${fieldName} cannot exceed ${maxLength} characters`
    }
    return null
  },

  url: (url: string) => {
    try {
      const urlObj = new URL(url)
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        return "URL must use http or https protocol"
      }
      return null
    } catch {
      return "Invalid URL format"
    }
  },

  pattern: (value: string, fieldName: string, regex: RegExp, errorMessage: string) => {
    if (!regex.test(value)) {
      return errorMessage
    }
    return null
  },

  multiple: (errors: (string | null)[]): string | null => {
    const firstError = errors.find((e) => e !== null)
    return firstError || null
  },
}

/**
 * Request body parsing with error handling
 */
export async function parseBody<T>(request: Request): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const data = await request.json()
    return { success: true, data }
  } catch {
    return { success: false, error: "Invalid JSON in request body" }
  }
}

/**
 * Safe database query wrapper
 */
export async function safeQuery<T = any>(
  query: string,
  params?: any[],
): Promise<{ success: true; rows: T[] } | { success: false; error: string }> {
  try {
    const result = await pool.query(query, params)
    return { success: true, rows: result.rows }
  } catch (err) {
    console.error("[DB Query Error]", query, err)
    return { success: false, error: "Database query failed" }
  }
}

/**
 * Wrap async route handler with standardized error handling
 */
export function withErrorHandling(
  handler: (req: Request) => Promise<NextResponse>,
) {
  return async (req: Request) => {
    try {
      return await handler(req)
    } catch (error) {
      console.error("[API Error]", error)
      return ApiResponse.serverError("An unexpected error occurred")
    }
  }
}
