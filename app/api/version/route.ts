import { NextResponse } from "next/server";
import {
  APP_VERSION,
  ENGINE_VERSION,
  RELEASES_URL,
} from "@/lib/config/constants";
import {
  CONFIG_API_CURRENT_VERSION,
  CONFIG_API_SUPPORTED_VERSIONS,
  CONFIG_API_V3_DEPRECATED_AT,
  CONFIG_API_V3_SUNSET,
} from "@/lib/config/config-values";
import { compareVersions } from "@/lib/updater/version-compare";
import { fetchLatestRelease } from "@/lib/updater/github-release";

/**
 * lib/updater/github-release.ts was extracted specifically so this route and
 * the admin updater routes would stop each doing their own GitHub fetch with
 * their own assumptions about the JSON shape. This route kept its copy anyway
 * and the two had already drifted on timeout (5s vs 10s), on caching, and on
 * how the release URL is derived. It now shares the module, passing the
 * caching and timeout it needs. This endpoint is public and nothing in the web
 * app calls it: its callers are the browser extension and self-hosters checking
 * their install, any number of whom can arrive at once, so it caches for an
 * hour rather than spending a GitHub rate-limit slot per request.
 */
const VERSION_CHECK_CACHE_SECONDS = 3600;
const VERSION_CHECK_TIMEOUT_MS = 5000;

/**
 * Which API versions this server speaks, for a client deciding what to call.
 * A missing block means a server older than 4.0.0. Built from constants alone
 * so that it is present on all three answers below: a client needs it just as
 * much when GitHub is unreachable. `deprecated` stays empty until the release
 * fills in the v3 retirement dates, rather than reporting empty strings as
 * dates.
 */
const API_VERSIONS = {
  current: CONFIG_API_CURRENT_VERSION,
  supported: CONFIG_API_SUPPORTED_VERSIONS,
  deprecated: CONFIG_API_V3_DEPRECATED_AT
    ? {
        v3: {
          deprecatedAt: CONFIG_API_V3_DEPRECATED_AT,
          sunsetAt: CONFIG_API_V3_SUNSET,
        },
      }
    : {},
};

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
        api: API_VERSIONS,
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
      api: API_VERSIONS,
      latest: release.version,
      status,
      message,
      release_url: release.htmlUrl,
    });
  } catch {
    return NextResponse.json({
      current: APP_VERSION,
      engine: ENGINE_VERSION,
      api: API_VERSIONS,
      latest: null,
      status: "unknown",
      message: "Could not check for updates. Are you offline?",
      release_url: RELEASES_URL,
    });
  }
}
