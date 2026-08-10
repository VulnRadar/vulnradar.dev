import type { Metadata } from "next";
import { PublicPageShell } from "@/components/shared/public-page-shell";
import { pageMetadata } from "@/lib/seo/metadata";
import { ChangelogList } from "@/components/changelog/changelog-list";

export const metadata: Metadata = pageMetadata({
  title: "Changelog",
  description:
    "Every release, in order: new checks, fixed detectors, security patches, and what changed underneath the scanner.",
  path: "/changelog",
  keywords: ["changelog", "release notes", "vulnerability scanner updates"],
});

export default function ChangelogPage() {
  return (
    <PublicPageShell maxWidth="max-w-6xl" padding="py-8 sm:py-10">
      <header className="mb-10 max-w-xl">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground mb-2">
          Changelog
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          Every release in order, including the security fixes, not just the
          features.
        </p>
      </header>

      <ChangelogList />
    </PublicPageShell>
  );
}
