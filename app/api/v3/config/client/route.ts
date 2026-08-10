import { NextResponse } from "next/server";
import { getSettings } from "@/lib/config/runtime-config";

// A handful of runtime-tier settings only matter to client components
// ("use client", can't call the server-only getSetting()/getSettings()
// resolver directly): poll intervals, dismiss windows, and a couple of
// feature flags that gate what a client component renders. This route is
// the one place those values cross from the admin-editable resolver to the
// browser. Nothing here is sensitive -- every value already ships in the
// client bundle today as a compiled default, this just makes the admin
// panel's edit actually reach the browser instead of being silently
// ignored. No auth required for the same reason.
export async function GET() {
  const settings = await getSettings([
    "VERSION_COOKIE_MAX_AGE_DAYS",
    "NOTIFICATION_POLL_INTERVAL_MS",
    "NOTIFICATION_DEFAULT_DISMISS_DAYS",
    "BROWSERBASE_LOGS_POLL_INTERVAL_MS",
    "SCAN_STATUS_POLL_INTERVAL_MS",
    "FEATURE_PDF_REPORTS",
  ] as const);

  return NextResponse.json(
    {
      versionCookieMaxAgeDays: settings.VERSION_COOKIE_MAX_AGE_DAYS,
      notificationPollIntervalMs: settings.NOTIFICATION_POLL_INTERVAL_MS,
      notificationDefaultDismissDays:
        settings.NOTIFICATION_DEFAULT_DISMISS_DAYS,
      browserbaseLogsPollIntervalMs: settings.BROWSERBASE_LOGS_POLL_INTERVAL_MS,
      scanStatusPollIntervalMs: settings.SCAN_STATUS_POLL_INTERVAL_MS,
      featurePdfReports: settings.FEATURE_PDF_REPORTS,
    },
    // Client components already have a compiled-constant fallback for
    // every one of these values, so a short cache is fine -- this is a
    // convenience refresh, not a security boundary.
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
