import type { Metadata } from "next";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { pageMetadata } from "@/lib/seo/metadata";
import { CHANGELOG } from "@/lib/changelog/data";
import { ChangelogList } from "@/components/changelog/changelog-list";

export const metadata: Metadata = pageMetadata({
  title: "Changelog: New Checks and Fixed Detectors",
  description:
    "Every release, in order: new checks, fixed detectors, security patches, and what changed underneath the scanner.",
  path: "/changelog",
  keywords: ["changelog", "release notes", "vulnerability scanner updates"],
});

export default function ChangelogPage() {
  const latest = CHANGELOG[0];

  return (
    <PublicPageShell maxWidth="max-w-6xl" padding="py-8 sm:py-10">
      {/* Changelog is a reading page, not a dashboard -- a centered column
          reads better than stretching cards across the full nav-matching
          shell width. */}
      <div className="mx-auto max-w-3xl">
        <header className="mb-10">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance text-foreground">
            Changelog
          </h1>
          <p className="max-w-[68ch] text-muted-foreground leading-relaxed">
            Every release in order, including the security fixes, not just the
            features. Each release is grouped by what kind of change it is, so
            you can read only the part you came for.
          </p>

          {/* Which version is current and when it shipped, without scrolling
              into the first card to find out. */}
          {latest && (
            <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-4 border-t border-border/50 pt-4">
              <div className="flex flex-col-reverse gap-0.5">
                <dt className="text-xs text-muted-foreground">Current</dt>
                <dd className="font-mono text-lg font-semibold leading-none text-foreground">
                  v{latest.version}
                </dd>
              </div>
              <div className="flex flex-col-reverse gap-0.5">
                <dt className="text-xs text-muted-foreground">Released</dt>
                <dd className="text-lg font-semibold leading-none text-foreground">
                  {latest.date}
                </dd>
              </div>
              <div className="flex flex-col-reverse gap-0.5">
                <dt className="text-xs text-muted-foreground">
                  Releases published
                </dt>
                <dd className="text-lg font-semibold leading-none tabular-nums text-foreground">
                  {CHANGELOG.length}
                </dd>
              </div>
            </dl>
          )}
        </header>

        <ChangelogList />
      </div>
    </PublicPageShell>
  );
}
