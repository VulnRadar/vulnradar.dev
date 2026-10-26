// Turns a manifest template into the manifest a build ships.
//
// Split out of build.mjs so the rules live in one importable place: the build
// uses it to write dist-chrome/ and dist-firefox/, and tests/extension runs the
// same function over both templates with the default host and a custom one.
// "No unresolved __API_HOST__ in the output" is only a claim a test can make
// about code it can call.

/** The hosted instance, used when VULNRADAR_API_HOST is not set. */
export const DEFAULT_API_HOST = "https://vulnradar.dev";

/** The store limit on a manifest `description`. */
export const MAX_DESCRIPTION_LENGTH = 132;

/**
 * The API origin a build talks to, from VULNRADAR_API_HOST or the default.
 *
 * A scheme and host (and port), nothing else. A trailing slash is trimmed
 * because the value is templated into `host_permissions` as `<host>/*` and
 * into the CSP's `connect-src`, and a double slash makes the first match
 * nothing and the second match only the root path. Anything that is not an
 * http(s) origin throws here rather than producing a manifest the browser
 * rejects after the zip is built.
 */
export function normalizeApiHost(raw) {
  const value = (raw || DEFAULT_API_HOST).trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`VULNRADAR_API_HOST is not a URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`VULNRADAR_API_HOST must be http or https: ${raw}`);
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username) {
    throw new Error(
      `VULNRADAR_API_HOST must be an origin with no path, query or credentials: ${raw}`,
    );
  }
  return url.origin;
}

/**
 * Fills `__VERSION__` and `__API_HOST__` in a parsed manifest template and
 * checks what comes out: nothing unresolved, and a description inside the
 * store's limit. Returns a new object; the template is not changed.
 */
export function resolveManifest(template, { version, apiHost }) {
  const host = normalizeApiHost(apiHost);
  const resolved = JSON.parse(
    JSON.stringify(template)
      .replace(/__VERSION__/g, version)
      .replace(/__API_HOST__/g, host),
  );
  const leftover = JSON.stringify(resolved).match(/__[A-Z_]+__/);
  if (leftover) {
    throw new Error(`manifest still contains the placeholder ${leftover[0]}`);
  }
  if (resolved.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(
      `manifest description is ${resolved.description.length} characters; the stores allow ${MAX_DESCRIPTION_LENGTH}`,
    );
  }
  return resolved;
}
