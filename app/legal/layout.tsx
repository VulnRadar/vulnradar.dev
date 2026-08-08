import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { BreadcrumbStructuredData } from "@/components/seo/structured-data";
import { LegalShell } from "@/components/legal";

const TITLE = "Legal";
const DESCRIPTION =
  "Terms of service, privacy policy, acceptable use, disclaimer, accessibility statement, and DMCA policy.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/legal",
  // /legal has child routes, so it must pass a title template down or the
  // nested pages render without the site name.
  isSectionRoot: true,
});

export default async function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <>
      <BreadcrumbStructuredData
        items={[{ name: "Legal", path: "/legal" }]}
        nonce={nonce}
      />
      <LegalShell>{children}</LegalShell>
    </>
  );
}
