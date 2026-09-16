/**
 * Whether a cookie this app sets must carry the Secure attribute.
 *
 * Every auth cookie is Secure in production, except on a deployment whose
 * operator set ALLOW_INSECURE_HTTP=1 because it terminates no TLS at all (see
 * .env.example). A browser silently drops a Secure cookie delivered over plain
 * HTTP, so without this exception such a deployment could never keep anyone
 * signed in, which is the one thing the flag exists to make possible.
 *
 * Eleven call sites used to decide this themselves, nine as
 * `NODE_ENV === "production"`, which ignored the flag, and two as
 * `baseUrl.startsWith("https://")`, which followed the configured URL instead.
 * Read at call time, not module load, so tests and a restarted process see
 * the current environment.
 *
 * Deliberately import-free: middleware runs on the Edge runtime.
 */
export function cookiesRequireHttps(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_INSECURE_HTTP !== "1"
  );
}
