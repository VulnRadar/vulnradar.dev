import { PREFIX } from "./route-registry";

/**
 * The trusted request header that tells a handler which projection to apply.
 * Middleware sets it on every /api request (overwriting whatever the client
 * sent) and deletes it on every other request, the same way it treats the
 * nonce and the request id.
 *
 * It selects the SHAPE of a response and nothing else. No authorisation,
 * scope, quota, terms-acceptance or rate-limit decision may read it: a gate
 * that depends on the version is a gate one version does not have.
 * tests/repo/api-registry-invariants.test.ts enforces that by file.
 */
export const API_VERSION_HEADER = "x-vr-api-version";

export type ApiMarker = "v3" | "v4" | "internal" | "permalink";
export type ApiVersion = "v3" | "v4";

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    // A relative URL, which a hand-built Request in a test can carry.
    return url.split(/[?#]/, 1)[0];
  }
}

/**
 * The marker wins when it is "v3" or "v4". With no marker, or any other
 * value, the answer comes from the URL: /api/v4 is v4 and everything else is
 * v3. The fallback fails closed. A handler under /api/v4 that is reached
 * without the header (a matcher regression, a middleware bypass) still
 * projects as v4, so it can never return the v3 superset (numeric ids,
 * operator-only fields) under a v4 URL. Alias requests always carry "v3" from
 * the same middleware pass that rewrote them, so the URL is not consulted for
 * them whatever it holds after a rewrite.
 */
export function apiVersionOf(request: {
  headers: Headers;
  url: string;
}): ApiVersion {
  const marker = request.headers.get(API_VERSION_HEADER);
  if (marker === "v3" || marker === "v4") return marker;
  return pathnameOf(request.url).startsWith(`${PREFIX.V4}/`) ? "v4" : "v3";
}
