import type { Metadata } from "next";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { pageMetadata } from "@/lib/seo/metadata";
import { ChangelogList } from "@/components/changelog/changelog-list";

export const metadata: Metadata = pageMetadata({
  title: "Changelog: New Checks and Fixed Detectors",
  description:
    "Every release, in order: new checks, fixed detectors, security patches, and what changed underneath the scanner.",
  path: "/changelog",
  keywords: ["changelog", "release notes", "vulnerability scanner updates"],
});

export default function ChangelogPage() {
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
          <p className="text-muted-foreground leading-relaxed">
            Every release in order, including the security fixes, not just the
            features.
          </p>
        </header>

        <ChangelogList />
      </div>
    </PublicPageShell>
  );
}
