import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";

import { buildError } from "@/lib/api/error-envelope";
import { apiVersionOf } from "@/lib/api/versions";
import {
  API_CLIENT_HEADER,
  REQUEST_ID_HEADER,
  normalizeApiClient,
  normalizeRequestId,
  runWithApiContext,
  runWithRequestId,
} from "@/lib/database/request-context";
import { logError } from "@/lib/logging/log";

import type { OpName } from "./types";

/**
 * The seam between one set of route handlers and the two API versions they
 * answer. The handler always returns the v3 superset, and v3 is that response
 * untouched: same object, so every status and header a client depends on
 * (Retry-After, WWW-Authenticate, X-RateLimit-*) survives without anyone
 * keeping a list of them.
 *
 * The projection onto the v4 contract is added here when v4 goes live. Until
 * then a v4 request is passed through as well, which nothing can observe:
 * middleware answers 404 for /api/v4 while v4 is not a supported version.
 *
 * `op` is unused until that projection reads it, and is required now so that
 * every route is already labelled with its operation when the projection
 * lands.
 */
export function versioned<TArgs extends [Request, ...unknown[]]>(
  op: OpName,
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return (...args: TArgs) => {
    const [request] = args;
    const apiVersion = apiVersionOf(request);
    const requestId =
      normalizeRequestId(request.headers.get(REQUEST_ID_HEADER)) ??
      randomUUID();
    const client = normalizeApiClient(request.headers.get(API_CLIENT_HEADER));

    return runWithRequestId(requestId, () =>
      runWithApiContext({ apiVersion, client }, async () => {
        try {
          return await handler(...args);
        } catch (error) {
          logError("API Error", `${op} threw`, error);
          return buildError({
            version: apiVersion,
            status: 500,
            message: "An unexpected error occurred",
            requestId,
          });
        }
      }),
    );
  };
}
