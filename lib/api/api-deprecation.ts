// API Deprecation Utilities

// Adds deprecation headers to v1 API responses to guide users to v2

import { NextResponse } from "next/server";
import { APP_URL } from "@/lib/config/constants";

// Deprecation date for v1 API (6 months from v2 release)
export const V1_DEPRECATION_DATE = "2026-09-01";
export const V1_SUNSET_DATE = "2026-12-01";

/**
 * Adds deprecation headers to a response
 * Following RFC 8594 (The Sunset HTTP Header Field)
 */
export function addDeprecationHeaders(
  response: NextResponse,
  endpoint: string,
): NextResponse {
  // Deprecation header (RFC draft)
  response.headers.set("Deprecation", `date="${V1_DEPRECATION_DATE}"`);

  // Sunset header (RFC 8594)
  response.headers.set("Sunset", new Date(V1_SUNSET_DATE).toUTCString());

  // Link to v2 equivalent
  const v2Endpoint = endpoint.replace("/api/v1/", "/api/v3/");
  response.headers.set(
    "Link",
    `<${APP_URL}${v2Endpoint}>; rel="successor-version"`,
  );

  // Custom deprecation warning header
  response.headers.set(
    "X-API-Deprecation-Warning",
    `This API version is deprecated and will stop responding on ${V1_SUNSET_DATE}. Migrate to /api/v3/. See ${APP_URL}/docs/developers for the migration guide.`,
  );

  return response;
}

/**
 * Creates a deprecated JSON response with headers
 */
export function deprecatedJsonResponse(
  data: unknown,
  endpoint: string,
  status: number = 200,
): NextResponse {
  const response = NextResponse.json(data, { status });
  return addDeprecationHeaders(response, endpoint);
}

/**
 * Creates a deprecation notice response body
 * Can be included in the response for visibility
 */
export function getDeprecationNotice(endpoint: string) {
  return {
    _deprecation: {
      message:
        "This API version is deprecated and will stop responding on " +
        V1_SUNSET_DATE +
        ". Migrate to /api/v3/.",
      successor: endpoint.replace("/api/v1/", "/api/v3/"),
      documentation: `${APP_URL}/docs/developers`,
      sunset_date: V1_SUNSET_DATE,
    },
  };
}

/**
 * Wraps response data with deprecation notice
 */
export function wrapWithDeprecationNotice(data: unknown, endpoint: string) {
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    return {
      ...data,
      ...getDeprecationNotice(endpoint),
    };
  }
  return {
    data,
    ...getDeprecationNotice(endpoint),
  };
}
