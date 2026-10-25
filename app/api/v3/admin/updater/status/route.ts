import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/authorization";
import {
  APP_VERSION,
  ENGINE_VERSION,
  RELEASES_URL,
} from "@/lib/config/constants";
import { compareVersions } from "@/lib/updater/version-compare";
import { fetchLatestRelease } from "@/lib/updater/github-release";
import { getCachedLatestRelease } from "@/lib/updater/release-summary";
import { isCosignAvailable } from "@/lib/updater/cosign";
import { commandAvailable } from "@/lib/updater/exec";
import { isUpdaterSupported } from "@/lib/updater/environment";
import { getActiveJobId } from "@/lib/updater/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v3/admin/updater/status
 *
 * Version-check signal for the admin "Updater" panel, reusing the same
 * compareVersions() logic GET /api/version uses (see
 * lib/updater/version-compare.ts) so the two never disagree. Also reports
 * whether cosign/tar are available on this host and whether an update job
 * is currently running, so the UI can show accurate capability info
 * before the admin clicks "Update now".
 *
 * `?summary=1` is the cheap form for the panel's nav dot: the release comes
 * from an hour-long memo (lib/updater/release-summary.ts) and the cosign and
 * tar probes are skipped, so the response has no cosignAvailable, tarAvailable
 * or releaseNotes. Every /admin load made this request, and the full form
 * asks GitHub live and forks two processes; the dot needs one boolean that
 * changes once per release. The Updater tab does not pass `summary`, because
 * an admin there has just asked for the live answer.
 */
export async function GET(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const summary = new URL(request.url).searchParams.get("summary") === "1";
  const support = isUpdaterSupported();

  const [release, probes] = await Promise.all([
    summary ? getCachedLatestRelease() : fetchLatestRelease().catch(() => null),
    summary
      ? Promise.resolve({})
      : Promise.all([
          isCosignAvailable(),
          commandAvailable("tar", ["--version"]),
        ]).then(([cosignAvailable, tarAvailable]) => ({
          cosignAvailable,
          tarAvailable,
        })),
  ]);

  const common = {
    current: APP_VERSION,
    engine: ENGINE_VERSION,
    supported: support.supported,
    unsupportedReason: support.reason ?? null,
    activeJobId: getActiveJobId(),
    ...probes,
  };

  if (!release) {
    return NextResponse.json({
      ...common,
      latest: null,
      status: "unknown" as const,
      message: "Could not check for updates right now.",
      releaseUrl: RELEASES_URL,
      releaseNotes: null,
    });
  }

  const comparison = compareVersions(APP_VERSION, release.version);

  return NextResponse.json({
    ...common,
    latest: release.version,
    status: comparison.status,
    message: comparison.message,
    releaseUrl: release.htmlUrl,
    // The notes can be long and the dot never reads them.
    releaseNotes: summary ? null : release.body,
  });
}
