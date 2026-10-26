import { NextResponse, type NextRequest } from "next/server";

/**
 * The only call to NextResponse.rewrite in the repository. ESLint bans it
 * everywhere else and tests/repo/api-registry-invariants.test.ts counts the
 * call sites.
 *
 * It is a security rule, not a style rule. Next treats a middleware rewrite as
 * an internal route change only when the destination has the same origin as
 * the request. If the origin differs, Next proxies the request to that host,
 * with its Cookie and Authorization headers and its body. A destination built
 * from the Host or X-Forwarded-Host header, requestSelfOrigin() or APP_URL
 * would therefore turn every alias into a credential-forwarding proxy for
 * whoever controls one of those values.
 *
 * request.nextUrl is built by Next from its own bind address, not from the
 * Host header, so cloning it cannot be steered by a client. Only the pathname
 * is replaced; the query string and the encoding of everything else survive.
 */
export function aliasRewrite(
  request: NextRequest,
  canonicalPath: string,
  init: { request: { headers: Headers } },
): NextResponse {
  if (!canonicalPath.startsWith("/api/")) {
    throw new Error(
      `aliasRewrite only rewrites to /api paths: ${canonicalPath}`,
    );
  }
  const destination = request.nextUrl.clone();
  destination.pathname = canonicalPath;
  if (destination.origin !== request.nextUrl.origin) {
    throw new Error("aliasRewrite destination left the request origin");
  }
  return NextResponse.rewrite(destination, init);
}
