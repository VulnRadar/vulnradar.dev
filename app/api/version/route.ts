import { NextResponse } from "next/server";
import {
  APP_VERSION,
  ENGINE_VERSION,
  VERSION_CHECK_URL,
  RELEASES_URL,
} from "@/lib/config/constants";
import { compareVersions } from "@/lib/updater/version-compare";

export async function GET() {
  try {
    const res = await fetch(VERSION_CHECK_URL, {
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 }, // cache for 1 hour
    });

    if (!res.ok) {
      return NextResponse.json({
        current: APP_VERSION,
        engine: ENGINE_VERSION,
        latest: null,
        status: "unknown",
        message: "Could not check for updates right now.",
        release_url: RELEASES_URL,
      });
    }

    const release = await res.json();
    const tagName = (release.tag_name as string) || "";
    const latest = tagName.replace(/^v/, "");
    const releaseUrl =
      (release.html_url as string) || `${RELEASES_URL}/tag/${tagName}`;

    const { status, message } = compareVersions(APP_VERSION, latest);

    return NextResponse.json({
      current: APP_VERSION,
      engine: ENGINE_VERSION,
      latest,
      status,
      message,
      release_url: releaseUrl,
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
