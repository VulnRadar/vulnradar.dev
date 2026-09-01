import type { Metadata } from "next";
import { DocsShell } from "@/components/docs/docs-shell";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";

const DESCRIPTION =
  "Guides for scanning, the REST API, webhooks, scheduled scans, self-hosting, and configuration. Start here to get a first scan running.";

export const metadata: Metadata = pageMetadata({
  title: `${APP_NAME} Docs: Scanning, API, and Self-Hosting`,
  description: DESCRIPTION,
  path: "/docs",
  keywords: ["security scanner documentation", "vulnerability scanner docs"],
  // /docs has child routes, so it must pass a title template down or the
  // nested pages render without the site name.
  isSectionRoot: true,
});

// seo: this layout deliberately emits NO JSON-LD. It used to render a
// BreadcrumbList of [Docs] and a TechArticle whose url was /docs, and because
// a layout renders on every route beneath it, each of the 19 child sections
// then carried two BreadcrumbList blocks (one a single-item trail pointing at
// the wrong page) and two TechArticle blocks whose url and headline
// contradicted each other and the page's own canonical. Google treats that as
// malformed and can discard the markup entirely, so every child page lost the
// rich-result eligibility the markup existed for. Each child layout emits its
// own correct pair; nothing belongs here.
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DocsShell>{children}</DocsShell>;
}
