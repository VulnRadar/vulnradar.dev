import { NextResponse } from "next/server";
import { MARKER_HEADER, aliasRewrite, resolveApiPath } from "./lib/alias.js";

const REQUEST_ID_HEADER = "x-request-id";
const NONCE_HEADER = "x-nonce";
const PATHNAME_HEADER = "x-pathname";

// Fixed values: the harness asserts they arrive unchanged.
const DEPRECATION = "@1798761600";
const SUNSET = "Thu, 01 Jul 2027 00:00:00 GMT";
const DEPRECATION_LINK =
  '</docs/api/migrate-v4>; rel="deprecation"; type="text/html"';

const CONTROL_PATH = "/api/spike-control/proxy-from-host";

function applySecurityHeaders(response, nonce, requestId) {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'nonce-${nonce}' 'strict-dynamic'; frame-ancestors 'none'`,
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload",
  );
  return response;
}

export function middleware(request) {
  const nonce = btoa(crypto.randomUUID());
  const requestId = crypto.randomUUID();
  const { pathname } = request.nextUrl;
  const resolved = resolveApiPath(pathname);
  const decisionPath = resolved.kind === "alias" ? resolved.to : pathname;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set(PATHNAME_HEADER, decisionPath);
  requestHeaders.set(
    "x-spike-hop",
    String(Number.parseInt(request.headers.get("x-spike-hop") ?? "0", 10) + 1),
  );
  requestHeaders.set("x-spike-forwarded", "yes");
  requestHeaders.set("x-spike-mw-url", request.url);
  requestHeaders.set("x-spike-mw-pathname", pathname);

  // Spec 4.3 step 3: set the marker on every API request, delete a
  // client-sent one on everything else, and drop Authorization for every
  // kind except v4 and alias-to-v4.
  if (resolved.kind === "other") {
    requestHeaders.delete(MARKER_HEADER);
  } else {
    const marker = resolved.kind === "alias" ? "v3" : resolved.kind;
    requestHeaders.set(MARKER_HEADER, marker);
  }
  const bearerAllowed =
    resolved.kind === "v4" ||
    (resolved.kind === "alias" && resolved.target === "v4");
  if (!bearerAllowed) requestHeaders.delete("authorization");

  if (pathname === CONTROL_PATH) {
    // POSITIVE CONTROL, never to be copied into product code. It builds a
    // rewrite destination from the Host header, which is exactly what S11
    // forbids. The harness points Host at its recording listener to prove two
    // things: that Next proxies a cross-origin rewrite (so a silent pass of the
    // real check would be meaningful), and that Cookie, Authorization and the
    // body travel with it. If this control is not proxied, the origin
    // assertion proves nothing and the harness reports it as inconclusive.
    //
    // It is an open proxy, and the fixture listens on every interface of the
    // machine that runs the harness, so it answers only a caller holding the
    // per-run token the harness gave the server. Anything else gets a 404.
    const token = process.env.SPIKE_CONTROL_TOKEN;
    if (!token || request.headers.get("x-spike-control") !== token) {
      return new NextResponse("not found", { status: 404 });
    }
    const host =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const destination = new URL(
      "/api/spike-control/target",
      `http://${host ?? "localhost"}`,
    );
    return applySecurityHeaders(
      NextResponse.rewrite(destination),
      nonce,
      requestId,
    );
  }

  const response =
    resolved.kind === "alias"
      ? aliasRewrite(request, resolved.to, {
          request: { headers: requestHeaders },
        })
      : NextResponse.next({ request: { headers: requestHeaders } });

  if (resolved.kind === "alias") {
    response.headers.set("Deprecation", DEPRECATION);
    response.headers.set("Sunset", SUNSET);
    response.headers.append("Link", DEPRECATION_LINK);
    if (resolved.target === "v4") {
      response.headers.append(
        "Link",
        `<${resolved.to}>; rel="successor-version"`,
      );
    }
  }
  response.headers.set("x-spike-decision", `${resolved.kind}:${decisionPath}`);

  return applySecurityHeaders(response, nonce, requestId);
}

export const config = {
  // The same shape as the real matcher: everything except static assets, so
  // page-kind requests (/security.txt is rewritten into /api by next.config)
  // pass through the middleware too.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
