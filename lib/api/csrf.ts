/**
 * SECURITY-AUDIT-2026-06-28 / H-6: CSRF protection via
 * Origin / Sec-Fetch-Site enforcement.
 *
 * Browsers attach the `Origin` header to all fetch/XHR requests with
 * methods other than GET / HEAD. Modern browsers also send the
 * `Sec-Fetch-Site` header indicating the relationship between the
 * requesting origin and the target (same-origin / same-site / cross-site
 * / none). For state-changing endpoints (POST / PUT / PATCH / DELETE),
 * VulnRadar requires both:
 *
 *   - `Origin` (or `Referer` as fallback) matches the configured app URL
 *   - `Sec-Fetch-Site` is "same-origin" or "same-site" (when present)
 *
 * The check is intentionally strict-by-default:
 *
 *   - Missing Origin + missing Referer → reject (defensive against
 *     older browsers / non-browser clients that don't send either)
 *   - Origin set but doesn't match → reject
 *   - Sec-Fetch-Site present and is "cross-site" → reject
 *   - Sec-Fetch-Site present and is "none" (typically a file:// or
 *     data:// URL, or a navigation) → reject for mutating verbs
 *
 * The middleware already rejects unauthenticated requests to /api/v3/
 * (only Bearer-token-authenticated API clients bypass the session
 * cookie), so the only legitimate non-cookie callers are programmatic
 * API key clients. Those clients must send the Origin header to
 * themselves (or use the API key Bearer token, which middleware
 * allows through).
 *
 * If you need to disable this in a non-browser testing harness, set
 * `process.env.SECURITY_ALLOW_NON_BROWSER_API=1`. (Production code
 * never sets this; the env var is documented for self-hosters running
 * curl-based integration tests against their own instance.)
 */
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Return true if the request's Origin (or Referer fallback) and
 * Sec-Fetch-Site header indicate it originated from a same-origin
 * browser context. Returns true (allow) for safe methods.
 *
 * Returns the response to send back if the check fails, or null if
 * the check passes.
 */
export async function csrfGuard(
  request: NextRequest,
  appUrl: string,
): Promise<NextResponse | null> {
  // Only enforce on mutating methods. GET / HEAD / OPTIONS are safe.
  const method = request.method.toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    return null;
  }

  // Allow self-hosters to opt out for testing. Must be NODE_ENV !== production
  // and the env var must be the literal string "1".
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.SECURITY_ALLOW_NON_BROWSER_API === "1"
  ) {
    return null;
  }

  const appOrigin = normalizeOrigin(appUrl);
  const requestOrigin = getRequestOrigin(request);

  if (!requestOrigin) {
    // No Origin and no Referer — reject. Defense-in-depth: most
    // modern browsers always send one or the other for mutating
    // requests. The only legitimate case this blocks is a server-to-
    // server caller with no Origin header — those should use Bearer
    // API keys via the Authorization header (middleware path).
    return NextResponse.json(
      {
        error:
          "CSRF check failed: request is missing both Origin and Referer headers. " +
          "Mutating requests from a browser must include one.",
      },
      { status: 403 },
    );
  }

  if (!sameOrigin(requestOrigin, appOrigin)) {
    return NextResponse.json(
      {
        error: "CSRF check failed: request Origin does not match this app.",
      },
      { status: 403 },
    );
  }

  // Sec-Fetch-Site is the modern replacement for the same-origin check.
  // When present, it MUST be "same-origin" or "same-site". When absent,
  // we already verified Origin equality above.
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json(
      {
        error:
          "CSRF check failed: Sec-Fetch-Site is " +
          fetchSite +
          "; expected same-origin or same-site.",
      },
      { status: 403 },
    );
  }

  return null;
}

function normalizeOrigin(url: string): string {
  try {
    const u = new URL(url);
    return u.origin.toLowerCase();
  } catch {
    return "";
  }
}

function getRequestOrigin(request: NextRequest): string | null {
  // Prefer Origin (sent on most mutating requests).
  const origin = request.headers.get("origin")?.trim();
  if (origin) return origin.toLowerCase();

  // Fall back to Referer — extract just the origin (strip path).
  const referer = request.headers.get("referer")?.trim();
  if (referer) {
    try {
      return new URL(referer).origin.toLowerCase();
    } catch {
      // Fall through.
    }
  }
  return null;
}

function sameOrigin(a: string, b: string): boolean {
  if (!a || !b) return false;
  // Both should already be normalized to origin form (scheme + host + port).
  return a === b;
}
