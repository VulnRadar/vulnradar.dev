import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import { LegalShell } from "@/components/legal";

const TITLE = "Legal: Terms, Privacy and DMCA";
const DESCRIPTION =
  "The terms of service, privacy policy, acceptable use policy, disclaimer, accessibility statement, and DMCA policy that govern using VulnRadar.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/legal",
  // /legal has child routes, so it must pass a title template down or the
  // nested pages render without the site name.
  isSectionRoot: true,
});

// No breadcrumb here. A layout wraps every legal page, so its one-item
// "Legal" trail was emitted alongside each page's own, and every legal page
// carried two BreadcrumbLists. The index page now emits its own.
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <LegalShell>{children}</LegalShell>;
}
