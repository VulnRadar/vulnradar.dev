import type { Metadata } from "next";
import { DocsShell } from "@/components/docs/docs-shell";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const TITLE = "Documentation";
const DESCRIPTION =
  "Guides for scanning, the REST API, webhooks, scheduled scans, self-hosting, and configuration. Start here to get a first scan running.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/docs",
  keywords: ["security scanner documentation", "vulnerability scanner docs"],
  // /docs has child routes, so it must pass a title template down or the
  // nested pages render without the site name.
  isSectionRoot: true,
});

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbStructuredData items={[{ name: "Docs", path: "/docs" }]} />
      <TechArticleStructuredData
        title={TITLE}
        description={DESCRIPTION}
        path="/docs"
      />
      <DocsShell>{children}</DocsShell>
    </>
  );
}
