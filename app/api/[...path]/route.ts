import type { NextRequest } from "next/server";

import { buildError } from "@/lib/api/error-envelope";
import { PREFIX } from "@/lib/api/route-registry";
import { CONFIG_API_SUPPORTED_VERSIONS } from "@/lib/config/config-values";

/**
 * Every /api path that no route serves. Without this file Next answered one
 * with its HTML 404 page, which an API client cannot parse, and which carried
 * no request id.
 *
 * Static and dynamic routes beat a catch-all in the App Router, so no real
 * route is affected. A signed-out caller never reaches it either: middleware
 * answers 401 first for anything that is not anonymous, which is what a
 * protected path that does not exist should look like to someone without a
 * session.
 */

const VERSION_SEGMENT = /^v\d+$/;

function notFound(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const head = pathname.split("/")[2] ?? "";

  if (pathname === PREFIX.V4 || pathname.startsWith(`${PREFIX.V4}/`)) {
    return buildError({
      version: "v4",
      status: 404,
      code: "NOT_IN_V4",
      message: "This path is not part of API v4.",
      requestId,
      details: {
        hint: "Dashboard routes are not part of the API. See /docs/api.",
      },
    });
  }

  if (
    VERSION_SEGMENT.test(head) &&
    !CONFIG_API_SUPPORTED_VERSIONS.includes(head)
  ) {
    return buildError({
      version: "other",
      status: 404,
      code: "UNSUPPORTED_API_VERSION",
      message: `API version ${head} is not served by this instance.`,
      requestId,
    });
  }

  return buildError({
    version: pathname.startsWith(`${PREFIX.INTERNAL}/`) ? "internal" : "other",
    status: 404,
    code: "NOT_FOUND",
    message: "No API route at this path.",
    requestId,
  });
}

export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
