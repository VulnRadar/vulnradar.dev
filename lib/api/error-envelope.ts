import { NextResponse } from "next/server";

import {
  ERROR_CODES,
  defaultCodeForStatus,
  type ErrorCode,
  type ErrorCodeSpec,
} from "./error-codes";
import type { ApiMarker } from "./versions";

export type ErrorSpace = ApiMarker | "other";

export interface BuildErrorInput {
  /** The space the failing request belongs to; v4 never carries `paused`. */
  version: ErrorSpace;
  status: number;
  message: string;
  /** Defaults to the generic code of the status. */
  code?: ErrorCode;
  requestId: string;
  details?: Record<string, unknown>;
  /** Seconds. Added to any status; 429 and 503 always get one. */
  retryAfter?: number;
  /**
   * Whether a 401 carries WWW-Authenticate. Defaults to true in the v4 space;
   * a v3 alias that reaches a v4 handler passes true, because the credential
   * it is missing is the same one.
   */
  bearerChallenge?: boolean;
  headers?: HeadersInit;
}

export interface ErrorEnvelope {
  error: string;
  code: ErrorCode;
  requestId: string;
  details?: Record<string, unknown>;
  paused?: true;
}

export const WWW_AUTHENTICATE_BEARER = 'Bearer realm="VulnRadar"';

/** Wait suggested with a 429 or 503 when nothing more specific is known. */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

function assertErrorStatus(status: number): void {
  if (!Number.isInteger(status) || status < 400 || status > 599) {
    throw new RangeError(`Not an error status: ${status}`);
  }
}

export function errorBody(input: BuildErrorInput): ErrorEnvelope {
  assertErrorStatus(input.status);
  const code = input.code ?? defaultCodeForStatus(input.status);
  const body: ErrorEnvelope = {
    error: input.message,
    code,
    requestId: input.requestId,
  };
  if (input.details !== undefined) body.details = input.details;
  // Readers of the old maintenance body test `paused`, so every space except
  // v4 keeps sending it; the code carries the same fact for everyone else.
  if (code === "SERVICE_PAUSED" && input.version !== "v4") body.paused = true;
  return body;
}

function retryAfterSeconds(
  input: BuildErrorInput,
  code: ErrorCode,
): string | null {
  if (input.retryAfter !== undefined && Number.isFinite(input.retryAfter)) {
    return String(Math.max(1, Math.ceil(input.retryAfter)));
  }
  if (input.status !== 429 && input.status !== 503) return null;
  const fixed = (ERROR_CODES[code] as ErrorCodeSpec).retryAfter;
  return String(fixed ?? DEFAULT_RETRY_AFTER_SECONDS);
}

/**
 * Errors are never cacheable: a 404 or 410 is cacheable by default, and a
 * cached brownout answer would outlive its window.
 */
export function errorHeaders(input: BuildErrorInput): Headers {
  assertErrorStatus(input.status);
  const headers = new Headers(input.headers);
  const code = input.code ?? defaultCodeForStatus(input.status);
  headers.set("Cache-Control", "no-store");
  const wait = retryAfterSeconds(input, code);
  if (wait !== null && !headers.has("Retry-After")) {
    headers.set("Retry-After", wait);
  }
  const challenge = input.bearerChallenge ?? input.version === "v4";
  if (input.status === 401 && challenge) {
    headers.set("WWW-Authenticate", WWW_AUTHENTICATE_BEARER);
  }
  return headers;
}

export function buildError(input: BuildErrorInput): NextResponse {
  return NextResponse.json(errorBody(input), {
    status: input.status,
    headers: errorHeaders(input),
  });
}
