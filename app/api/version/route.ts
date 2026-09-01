import { NextResponse } from "next/server";
import {
  APP_VERSION,
  ENGINE_VERSION,
  RELEASES_URL,
} from "@/lib/config/constants";
import { compareVersions } from "@/lib/updater/version-compare";
import { fetchLatestRelease } from "@/lib/updater/github-release";

/**
 * lib/updater/github-release.ts was extracted specifically so this route and
 * the admin updater routes would stop each doing their own GitHub fetch with
 * their own assumptions about the JSON shape. This route kept its copy anyway
 * and the two had already drifted on timeout (5s vs 10s), on caching, and on
 * how the release URL is derived. It now shares the module, passing the
 * caching and timeout it needs: this endpoint is public and hit on ordinary
 * page loads, so it caches for an hour rather than spending a GitHub
 * rate-limit slot per visitor.
 */
const VERSION_CHECK_CACHE_SECONDS = 3600;
const VERSION_CHECK_TIMEOUT_MS = 5000;

export async function GET() {
  try {
    const release = await fetchLatestRelease({
      revalidateSeconds: VERSION_CHECK_CACHE_SECONDS,
      timeoutMs: VERSION_CHECK_TIMEOUT_MS,
    });

    if (!release) {
      return NextResponse.json({
        current: APP_VERSION,
        engine: ENGINE_VERSION,
        latest: null,
        status: "unknown",
        message: "Could not check for updates right now.",
        release_url: RELEASES_URL,
      });
    }

    const { status, message } = compareVersions(APP_VERSION, release.version);

    return NextResponse.json({
      current: APP_VERSION,
      engine: ENGINE_VERSION,
      latest: release.version,
      status,
      message,
      release_url: release.htmlUrl,
    });
  } catch {
    return NextResponse.json({
      current: APP_VERSION,
      engine: ENGINE_VERSION,
      latest: null,
      status: "unknown",
      message: "Could not check for updates. Are you offline?",
      release_url: RELEASES_URL,
    });
  }
}
