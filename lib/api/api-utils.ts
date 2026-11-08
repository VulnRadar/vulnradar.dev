import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/auth";
import pool from "@/lib/database/db";
import { ERROR_MESSAGES } from "@/lib/config/constants";
import { defaultCodeForStatus, type ErrorCode } from "@/lib/api/error-codes";
import { buildError, errorBody, errorHeaders } from "@/lib/api/error-envelope";
import {
  MAX_REQUEST_BODY_BYTES,
  readBodyBounded,
} from "@/lib/api/request-limits";
import { logError } from "@/lib/logging/log";
import { redactPathTokens } from "@/lib/logging/redact-path";
import {
  REQUEST_ID_HEADER,
  currentApiVersion,
  currentRequestId,
  normalizeRequestId,
  runWithRequestId,
} from "@/lib/database/request-context";

/**
 * The correlation id a response should name: the ambient one, else the
 * x-request-id middleware put on the request. Routes that never went through
 * withErrorHandling have no ambient id, which is why the second source exists.
 * Null when neither is usable.
 */
function knownRequestId(request?: Pick<Request, "headers">): string | null {
  return (
    currentRequestId() ??
    normalizeRequestId(request?.headers.get(REQUEST_ID_HEADER))
  );
}

/**
 * An error in the shape every /api/v3 client already reads, plus the two keys
 * v4 standardises on. `meta` goes last because the admin routes send their own
 * `code` ("2fa_required") and the SPA branches on it.
 *
 * These helpers take no request, so `requestId` is only present when there is
 * an ambient id; a made-up one would match nothing in the logs or in the
 * x-request-id header the client also receives. A route that wants it without
 * being wrapped calls ApiResponse.fail with its request.
 */
function legacyError(
  message: string,
  status: number,
  meta?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      error: message,
      status,
      code: defaultCodeForStatus(status),
      requestId: currentRequestId() ?? undefined,
      ...meta,
    },
    { status },
  );
}

export interface ApiFailure {
  code?: ErrorCode;
  message: string;
  status: number;
  details?: Record<string, unknown>;
  retryAfter?: number;
  headers?: HeadersInit;
  bearerChallenge?: boolean;
  /** Supplies the x-request-id when the route has no ambient id. */
  request?: Pick<Request, "headers">;
  /**
   * Keys existing v3 clients read (`statusCode`, `success: false`). Sent on
   * every space but v4, whose envelope is closed.
   */
  legacy?: Record<string, unknown>;
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

  /**
   * An error with a code from the closed registry. Under versioned() on a v4
   * request this is exactly the v4 envelope; everywhere else the same body
   * also carries the keys v3 clients already read, so moving a route onto
   * this helper only ever adds to what they receive.
   */
  fail: ({ legacy, request, ...failure }: ApiFailure): NextResponse => {
    const input = {
      ...failure,
      version: currentApiVersion() ?? ("v3" as const),
      requestId: knownRequestId(request) ?? randomUUID(),
    };
    if (input.version === "v4") return buildError(input);
    return NextResponse.json(
      { ...errorBody(input), status: input.status, ...legacy },
      { status: input.status, headers: errorHeaders(input) },
    );
  },

  // Client error responses (4xx)
  error: (message: string, status = 400) => legacyError(message, status),

  badRequest: (
    message = "The request could not be processed. Please check your input.",
  ) => legacyError(message, 400),

  unauthorized: (message = ERROR_MESSAGES.UNAUTHORIZED) =>
    legacyError(message, 401),

  forbidden: (
    message: string = ERROR_MESSAGES.FORBIDDEN,
    meta?: Record<string, unknown>,
  ) => legacyError(message, 403, meta),

  notFound: (message = ERROR_MESSAGES.NOT_FOUND) => legacyError(message, 404),

  methodNotAllowed: (
    message = "This HTTP method is not supported for this endpoint.",
  ) => legacyError(message, 405),

  conflict: (
    message = "The request conflicts with the current state of the resource.",
  ) => legacyError(message, 409),

  tooManyRequests: (
    message = "Rate limit exceeded. Please slow down your requests.",
    retryAfter?: number,
  ) => {
    const response = legacyError(message, 429);
    if (retryAfter) {
      response.headers.set("Retry-After", String(retryAfter));
    }
    return response;
  },

  // Server error responses (5xx)
  serverError: (message = ERROR_MESSAGES.SERVER_ERROR) =>
    legacyError(message, 500),
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
 * An address someone is giving us for the first time: signup, a staff invite,
 * a profile change. It has to be one mail could reach, so exactly one @, a
 * local part, a domain with a dot in it, nothing that is whitespace or a
 * control character, and at most 254 characters (the longest path SMTP
 * carries). Not a full RFC 5322 parser on purpose: the verification link is
 * what proves the address, this only refuses strings that could never be one.
 * Callers normalise (trim, lowercase) first.
 */
export function isValidEmailAddress(email: unknown): email is string {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    // Both control blocks: C0 and DEL, and C1 (U+0080 to U+009F), whose
    // NEL is not in the whitespace class and would otherwise pass as part of
    // an address.
    // oxlint-disable-next-line no-control-regex -- refusing control characters is the point
    /[\s\u0000-\u001f\u007f-\u009f]/.test(email)
  ) {
    return false;
  }
  const parts = email.split("@");
  return (
    parts.length === 2 &&
    Boolean(parts[0]) &&
    Boolean(parts[1]) &&
    parts[1].includes(".") &&
    !parts[1].startsWith(".") &&
    !parts[1].endsWith(".")
  );
}

/**
 * An address that names an account which already exists: sign-in,
 * forgot-password, resend-verification. Those were stored under the old rule
 * (any string with an @), and a self-hosted first account is often
 * admin@localhost, so holding them to isValidEmailAddress would lock their
 * owners out. The lookup itself is what decides whether the account exists.
 */
export function isLookupEmailAddress(email: unknown): email is string {
  return typeof email === "string" && email.includes("@");
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

  email: (email: string) =>
    isValidEmailAddress(email) ? null : "Please enter a valid email address",

  emailForLookup: (email: string) =>
    isLookupEmailAddress(email) ? null : "Please enter a valid email address",

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
 * L-10: Hard cap on JSON request bodies. The value and the reasoning live in
 * lib/api/request-limits.ts, because middleware.ts enforces the same cap and
 * cannot import this module (edge runtime, and this one pulls in the pool).
 * Middleware only sees a declared Content-Length; readBodyBounded is what
 * bounds a chunked body here. ref: AUDIT-013#dup-04
 */
function bodyTooLargeMessage(): string {
  return `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`;
}

/**
 * Request body parsing with error handling
 */
export async function parseBody<T>(
  request: Request,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const contentType = request.headers.get("content-type") || "";
    const contentLength = request.headers.get("content-length");

    // api: reject oversized payloads before reading them.
    if (contentLength !== null) {
      const len = Number.parseInt(contentLength, 10);
      if (Number.isFinite(len) && len > MAX_REQUEST_BODY_BYTES) {
        return { success: false, error: bodyTooLargeMessage() };
      }
    }

    // Only parse JSON if content-type indicates JSON
    if (contentType.includes("application/json")) {
      // Empty body with content-type=application/json: treat as {}
      if (contentLength === "0") {
        return { success: true, data: {} as T };
      }
      const body = await readBodyBounded(request);
      if (!body.ok) return { success: false, error: bodyTooLargeMessage() };
      try {
        return { success: true, data: JSON.parse(body.text) as T };
      } catch {
        // The client sent bad JSON. That is an answer, not a server fault, so
        // it does not belong in the error log.
        return { success: false, error: "Failed to parse request body" };
      }
    }

    // Fallback for missing content-type (assume JSON if not FormData)
    if (!contentType.includes("multipart/form-data")) {
      // No body at all → empty object. (This happens when sendBeacon
      // is called with no body, or a fetch fires with no body.)
      if (contentLength === null || contentLength === "0") {
        return { success: true, data: {} as T };
      }
      const body = await readBodyBounded(request);
      if (!body.ok) return { success: false, error: bodyTooLargeMessage() };
      try {
        return { success: true, data: JSON.parse(body.text) as T };
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

const INVALID_BODY_MESSAGE = "Invalid request body.";

export type JsonObjectResult<T> =
  { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * A JSON request body that is required to be an object. `await request.json()`
 * followed by `body.url` turns `null`, `[]` or `"x"` into a TypeError and a
 * 500, for what is the client's mistake; every refusal here is a 400 and none
 * of them is logged.
 *
 * An empty body is invalid too unless the route opts in, because a route that
 * needs fields should say so rather than run with none of them.
 */
export async function readJsonObject<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  request: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<JsonObjectResult<T>> {
  const invalid = (): JsonObjectResult<T> => ({
    ok: false,
    response: ApiResponse.fail({
      code: "INVALID_REQUEST",
      message: INVALID_BODY_MESSAGE,
      status: 400,
      request,
    }),
  });

  let body: Awaited<ReturnType<typeof readBodyBounded>>;
  try {
    body = await readBodyBounded(request);
  } catch {
    // The client hung up midway, or the body was already consumed.
    return invalid();
  }
  if (!body.ok) {
    return {
      ok: false,
      response: ApiResponse.fail({
        code: "PAYLOAD_TOO_LARGE",
        message: bodyTooLargeMessage(),
        status: 413,
        request,
      }),
    };
  }

  if (body.text.trim() === "") {
    return options.allowEmpty ? { ok: true, data: {} as T } : invalid();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return invalid();
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return invalid();
  }
  return { ok: true, data: parsed as T };
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

/** "GET /api/v3/scan", from the request alone. */
function describeRequest(request: Request): string {
  let pathname = "an unparseable URL";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    // A Request cannot be built from a bad URL, so this is unreachable for a
    // real one; a test double can still get here.
  }
  return `${request.method} ${redactPathTokens(pathname)}`;
}

/**
 * Wrap async route handler with standardized error handling.
 * Accepts NextRequest (and its base Request) so route handlers can
 * use Next.js-specific APIs like cookies, nextUrl, etc.
 *
 * Returns a function with the same shape as the original, so it works
 * for routes that take just `(req)`, routes that take `(req, ctx)` for
 * dynamic params, and routes that take `(_req, { params })`.
 *
 * AUDIT-012#obs-07: this is also where a request's correlation id enters
 * Node-side context. middleware.ts mints the id and forwards it as the
 * `x-request-id` request header; it cannot hand over an AsyncLocalStorage
 * because it runs on the Edge runtime and this does not, so the header is
 * the only channel and something on the Node side has to re-enter it.
 * Doing it in this wrapper (rather than per route) means every
 * console.error a handler triggers, at any depth, tags its
 * system_error_logs row with the same id -- which is the whole point:
 * route -> executeScan -> a check -> safeFetch used to produce four
 * unrelated-looking rows.
 */
export function withErrorHandling<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args: TArgs) => {
    // Falls back to a locally minted id when the header is absent or
    // malformed (a route reached outside the middleware matcher, or an
    // internal caller invoking a wrapped handler directly). The row is
    // still correlated with its siblings; it just is not one the client
    // was told about.
    const first = args[0];
    const requestId =
      (first instanceof Request
        ? normalizeRequestId(first.headers.get(REQUEST_ID_HEADER))
        : null) ?? randomUUID();
    return runWithRequestId(requestId, async () => {
      try {
        return await handler(...args);
      } catch (error) {
        // Name the route. This used to log "[API Error]" and the error, so a
        // row said that something threw and the stack was the only clue to
        // which of ~170 routes it was, and only when the stack survived. The
        // pathname alone, never the query string: that is where tokens and
        // email addresses end up. Token-shaped path segments are masked too,
        // since /staff-invite/[token] carries a raw invite token in the path.
        logError(
          "API Error",
          `${first instanceof Request ? describeRequest(first) : "an unknown route"} threw`,
          error,
        );
        return ApiResponse.serverError("An unexpected error occurred");
      }
    });
  };
}
