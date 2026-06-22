import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";

/**
 * Standard API response helpers to reduce boilerplate across routes
 */

export interface ApiErrorResponse {
  error: string;
}

export interface ApiSuccessResponse<T> {
  data?: T;
  message?: string;
  [key: string]: unknown;
}

/**
 * JSON response helpers
 */
/**
 * Standardized API response helpers
 * All responses follow a consistent format for professional, clear communication
 */
export const ApiResponse = {
  // Success responses
  success: <T>(data: T, status = 200) => NextResponse.json(data, { status }),

  // Client error responses (4xx)
  error: (message: string, status = 400) =>
    NextResponse.json({ error: message, status }, { status }),

  badRequest: (
    message = "The request could not be processed. Please check your input.",
  ) => NextResponse.json({ error: message, status: 400 }, { status: 400 }),

  unauthorized: (message = ERROR_MESSAGES.UNAUTHORIZED) =>
    NextResponse.json({ error: message, status: 401 }, { status: 401 }),

  forbidden: (
    message: string = ERROR_MESSAGES.FORBIDDEN,
    meta?: Record<string, unknown>,
  ) => NextResponse.json({ error: message, status: 403 }, { status: 403 }),

  notFound: (message = ERROR_MESSAGES.NOT_FOUND) =>
    NextResponse.json({ error: message, status: 404 }, { status: 404 }),

  methodNotAllowed: (
    message = "This HTTP method is not supported for this endpoint.",
  ) => NextResponse.json({ error: message, status: 405 }, { status: 405 }),

  conflict: (
    message = "The request conflicts with the current state of the resource.",
  ) => NextResponse.json({ error: message, status: 409 }, { status: 409 }),

  tooManyRequests: (
    message = "Rate limit exceeded. Please slow down your requests.",
    retryAfter?: number,
  ) => {
    const response = NextResponse.json(
      { error: message, status: 429 },
      { status: 429 },
    );
    if (retryAfter) {
      response.headers.set("Retry-After", String(retryAfter));
    }
    return response;
  },

  // Server error responses (5xx)
  serverError: (message = ERROR_MESSAGES.SERVER_ERROR) =>
    NextResponse.json({ error: message, status: 500 }, { status: 500 }),
};

/**
 * Authentication guard for protected routes
 */
export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    return {
      authorized: false,
      error: ApiResponse.unauthorized("Authentication required"),
      session: null,
    };
  }

  // Check if account is disabled
  const userCheck = await pool.query(
    "SELECT disabled_at FROM users WHERE id = $1",
    [session.userId],
  );
  if (userCheck.rows[0]?.disabled_at) {
    return {
      authorized: false,
      error: ApiResponse.forbidden(ERROR_MESSAGES.ACCOUNT_DISABLED),
      session: null,
    };
  }

  return {
    authorized: true,
    error: null,
    session,
  };
}

/**
 * Validation helpers
 */
export const Validate = {
  required: (value: unknown, fieldName: string) => {
    if (!value) {
      return `${fieldName} is required`;
    }
    return null;
  },

  email: (email: string) => {
    if (typeof email !== "string" || !email.includes("@")) {
      return "Please enter a valid email address";
    }
    return null;
  },

  password: (password: string, minLength = 8) => {
    if (typeof password !== "string" || password.length < minLength) {
      return `Password must be at least ${minLength} characters`;
    }
    return null;
  },

  string: (
    value: unknown,
    fieldName: string,
    minLength = 1,
    maxLength?: number,
  ) => {
    if (typeof value !== "string" || value.trim().length < minLength) {
      return `${fieldName} must be at least ${minLength} characters`;
    }
    if (maxLength && value.trim().length > maxLength) {
      return `${fieldName} cannot exceed ${maxLength} characters`;
    }
    return null;
  },

  url: (url: string) => {
    try {
      const urlObj = new URL(url);
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        return "URL must use http or https protocol";
      }
      return null;
    } catch {
      return "Invalid URL format";
    }
  },

  pattern: (
    value: string,
    fieldName: string,
    regex: RegExp,
    errorMessage: string,
  ) => {
    if (!regex.test(value)) {
      return errorMessage;
    }
    return null;
  },

  multiple: (errors: (string | null)[]): string | null => {
    const firstError = errors.find((e) => e !== null);
    return firstError || null;
  },
};

/**
 * L-10: Hard cap on JSON request bodies. Without this, a client can
 * send a multi-GB JSON body that the server will buffer before
 * rejecting. 1 MiB is more than enough for our route shapes (the
 * largest legitimate payload is a few KB).
 */
const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;

/**
 * Request body parsing with error handling
 */
export async function parseBody<T>(
  request: Request,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const contentType = request.headers.get("content-type") || "";
    const contentLength = request.headers.get("content-length");

    // L-10: Reject oversized payloads before reading them.
    if (contentLength !== null) {
      const len = Number.parseInt(contentLength, 10);
      if (Number.isFinite(len) && len > MAX_REQUEST_BODY_BYTES) {
        return {
          success: false,
          error: `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`,
        };
      }
    }

    // Only parse JSON if content-type indicates JSON
    if (contentType.includes("application/json")) {
      const data = await request.json();
      return { success: true, data };
    }

    // Fallback for missing content-type (assume JSON if not FormData)
    if (!contentType.includes("multipart/form-data")) {
      try {
        const data = await request.json();
        return { success: true, data };
      } catch {
        return { success: false, error: "Invalid JSON in request body" };
      }
    }

    return { success: false, error: "Unsupported content-type" };
  } catch (error) {
    console.error("[Parse Body Error]", error);
    return { success: false, error: "Failed to parse request body" };
  }
}

/**
 * Safe database query wrapper
 */
export async function safeQuery<T = unknown>(
  query: string,
  params?: unknown[],
): Promise<{ success: true; rows: T[] } | { success: false; error: string }> {
  try {
    const result = await pool.query(query, params);
    return { success: true, rows: result.rows };
  } catch (err) {
    // Don't echo the full query text back to logs — it often contains
    // column names that can leak schema, and in some legacy call sites
    // interpolated values that may include user input. Log the params
    // length instead so error context is still preserved.
    console.error("[DB Query Error]", {
      message: err instanceof Error ? err.message : "non-Error thrown",
      paramCount: params?.length ?? 0,
    });
    return { success: false, error: "Database query failed" };
  }
}

/**
 * Wrap async route handler with standardized error handling.
 * Accepts NextRequest (and its base Request) so route handlers can
 * use Next.js-specific APIs like cookies, nextUrl, etc.
 *
 * Returns a function with the same shape as the original, so it works
 * for routes that take just `(req)`, routes that take `(req, ctx)` for
 * dynamic params, and routes that take `(_req, { params })`.
 */
export function withErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error("[API Error]", error);
      return ApiResponse.serverError("An unexpected error occurred");
    }
  };
}
