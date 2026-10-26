// The closed registry of machine-readable error codes for API v4 and for the
// errors the middleware itself produces. It also feeds the OpenAPI ErrorCode
// enum and the generated /docs/api/errors table, so a code exists here or it
// does not exist. Routes under /api/internal keep their own bodies and are
// outside this registry.
//
// Imports nothing: middleware uses it, and middleware compiles to the edge.

export interface ErrorCodeSpec {
  /** The HTTP statuses this code may travel with. */
  readonly statuses: readonly number[];
  readonly meaning: string;
  /** Seconds, for codes whose wait does not depend on the caller's state. */
  readonly retryAfter?: number;
}

export const ERROR_CODES = {
  INVALID_REQUEST: {
    statuses: [400, 422],
    meaning:
      "The body, query or parameters are malformed or fail validation. Validation problems are listed in details.",
  },
  INVALID_ID: {
    statuses: [400],
    meaning: "A path id is not a 32 character hex scan id.",
  },
  UNAUTHENTICATED: {
    statuses: [401],
    meaning: "No credential was sent.",
  },
  INVALID_API_KEY: {
    statuses: [401],
    meaning:
      "The API key is unknown, revoked, used from an address it is not bound to, or belongs to a disabled account. These cases share one answer on purpose, so a leaked key gets no validity oracle.",
  },
  FORBIDDEN: {
    statuses: [403],
    meaning: "The caller is not allowed to do this.",
  },
  SCOPE_MISSING: {
    statuses: [403],
    meaning: "The API key lacks the scope this operation needs.",
  },
  TERMS_ACCEPTANCE_REQUIRED: {
    statuses: [403],
    meaning: "The account has not accepted the current terms.",
  },
  CSRF_REJECTED: {
    statuses: [403],
    meaning:
      "The request failed the Origin check that protects state-changing calls.",
  },
  BLOCKED: {
    statuses: [403],
    meaning: "The target may not be scanned. details.reason says why.",
  },
  DOMAIN_NOT_VERIFIED: {
    statuses: [403],
    meaning: "The operation needs a domain the account has verified.",
  },
  CRAWL_PAGE_LIMIT: {
    statuses: [403],
    meaning: "The crawl asks for more pages than the plan allows.",
  },
  AUTH_FAILED: {
    statuses: [422],
    meaning: "The authenticated scan could not log in with the details given.",
  },
  UPGRADE_REQUIRED: {
    statuses: [402],
    meaning: "The feature needs a paid plan.",
  },
  BROWSER_QUOTA_EXHAUSTED: {
    statuses: [402],
    meaning: "The browser session quota is used up.",
  },
  NOT_FOUND: {
    statuses: [404],
    meaning: "No such path or resource.",
  },
  SCAN_NOT_FOUND: {
    statuses: [404],
    meaning: "No scan with this id belongs to the caller.",
  },
  NOT_IN_V4: {
    statuses: [404],
    meaning: "The path is not part of the v4 API.",
  },
  UNSUPPORTED_API_VERSION: {
    statuses: [404],
    meaning: "The API version in the path is not served by this instance.",
  },
  METHOD_NOT_ALLOWED: {
    statuses: [405],
    meaning: "The path exists, but not for this HTTP method.",
  },
  CONFLICT: {
    statuses: [409],
    meaning: "The request conflicts with the current state of the resource.",
  },
  SCAN_NOT_CANCELLABLE: {
    statuses: [409],
    meaning: "The scan has already finished, so it cannot be cancelled.",
  },
  API_VERSION_SUNSET: {
    statuses: [410],
    meaning: "This API version has been retired on this instance.",
  },
  PAYLOAD_TOO_LARGE: {
    statuses: [413],
    meaning: "The request body is over the size limit.",
  },
  DAILY_LIMIT: {
    statuses: [429],
    meaning: "The plan's daily scan quota is used up.",
  },
  API_QUOTA_EXCEEDED: {
    statuses: [429],
    meaning: "The API key's request budget is used up.",
  },
  CONCURRENT_SCAN_LIMIT: {
    statuses: [429],
    meaning: "Too many scans are already running for this account.",
    retryAfter: 10,
  },
  TARGET_RATE_LIMIT: {
    statuses: [429],
    meaning: "This target was scanned too often in a short time.",
  },
  BULK_RATE_LIMIT: {
    statuses: [429],
    meaning: "Too many bulk submissions in a short time.",
  },
  RATE_LIMITED: {
    statuses: [429],
    meaning: "Too many requests in a short time.",
  },
  INTERNAL_ERROR: {
    statuses: [500],
    meaning: "Something failed on the server.",
  },
  SERVICE_PAUSED: {
    statuses: [503],
    meaning:
      "The service is paused for maintenance, or scanning is paused by an operator.",
    retryAfter: 300,
  },
  SERVICE_UNAVAILABLE: {
    statuses: [503],
    meaning: "A dependency is unavailable. Retry later.",
  },
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_NAMES = Object.keys(ERROR_CODES) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ERROR_CODES, value)
  );
}

const STATUS_DEFAULTS: Readonly<Record<number, ErrorCode>> = {
  400: "INVALID_REQUEST",
  401: "UNAUTHENTICATED",
  402: "UPGRADE_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  410: "API_VERSION_SUNSET",
  413: "PAYLOAD_TOO_LARGE",
  422: "INVALID_REQUEST",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

/**
 * The generic code of an HTTP status, which is also what a client falls back
 * to for a code it does not know. A status outside the table gets the generic
 * code of its class.
 */
export function defaultCodeForStatus(status: number): ErrorCode {
  const exact = STATUS_DEFAULTS[status];
  if (exact) return exact;
  return status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST";
}

export function statusAllowsCode(code: ErrorCode, status: number): boolean {
  return (ERROR_CODES[code].statuses as readonly number[]).includes(status);
}
