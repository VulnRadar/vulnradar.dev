import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/authorization";
import {
  APP_VERSION,
  ENGINE_VERSION,
  RELEASES_URL,
} from "@/lib/config/constants";
import { compareVersions } from "@/lib/updater/version-compare";
import { fetchLatestRelease } from "@/lib/updater/github-release";
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
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 },
    );
  }

  const support = isUpdaterSupported();

  const [release, cosignAvailable, tarAvailable] = await Promise.all([
    fetchLatestRelease().catch(() => null),
    isCosignAvailable(),
    commandAvailable("tar", ["--version"]),
  ]);

  if (!release) {
    return NextResponse.json({
      current: APP_VERSION,
      engine: ENGINE_VERSION,
      latest: null,
      status: "unknown" as const,
      message: "Could not check for updates right now.",
      releaseUrl: RELEASES_URL,
      releaseNotes: null,
      supported: support.supported,
      unsupportedReason: support.reason ?? null,
      cosignAvailable,
      tarAvailable,
      activeJobId: getActiveJobId(),
    });
  }

  const comparison = compareVersions(APP_VERSION, release.version);

  return NextResponse.json({
    current: APP_VERSION,
    engine: ENGINE_VERSION,
    latest: release.version,
    status: comparison.status,
    message: comparison.message,
    releaseUrl: release.htmlUrl,
    releaseNotes: release.body,
    supported: support.supported,
    unsupportedReason: support.reason ?? null,
    cosignAvailable,
    tarAvailable,
    activeJobId: getActiveJobId(),
  });
}
