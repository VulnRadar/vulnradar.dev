import {
  fetchLatestRelease,
  type GithubRelease,
} from "@/lib/updater/github-release";

/**
 * The latest release, remembered for an hour, for the admin panel's nav dot.
 *
 * Every /admin load called the updater status route, which asked GitHub for the
 * latest release with no caching and then forked `cosign version` and
 * `tar --version`, only to set one boolean: is an update available. That is an
 * unauthenticated api.github.com request per page load against a 60 an hour
 * limit per IP, and two child processes, for a value that changes once per
 * release.
 *
 * A memo here rather than `next: { revalidate }` on the fetch: the status route
 * is force-dynamic, and a dynamic route sets every fetch in it to no-store, so
 * a revalidate window passed from there would be silently ignored. The Updater
 * tab itself keeps asking for the live answer; only the summary uses this.
 *
 * A failed lookup is remembered too, for a shorter time, so GitHub being down
 * or rate-limiting this host is not retried on every page load of every admin.
 */
const RELEASE_TTL_MS = 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;

let cached: { release: GithubRelease | null; expiresAt: number } | null = null;

export async function getCachedLatestRelease(): Promise<GithubRelease | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.release;
  const release = await fetchLatestRelease().catch(() => null);
  cached = {
    release,
    expiresAt: now + (release ? RELEASE_TTL_MS : FAILURE_TTL_MS),
  };
  return release;
}

/** For tests: forget what was remembered. */
export function resetCachedLatestRelease(): void {
  cached = null;
}
