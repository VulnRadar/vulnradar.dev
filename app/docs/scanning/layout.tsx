import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const DESCRIPTION =
  "Quick, Deep and Bulk scans, what each result panel shows and where its data comes from, scanning behind a login, and importing targets from an API spec.";

export const metadata: Metadata = pageMetadata({
  title: "Scanning a Site: Quick, Deep, Bulk and Signed-In Scans",
  description: DESCRIPTION,
  path: "/docs/scanning",
  keywords: [
    "website security scan",
    "authenticated vulnerability scan",
    "openapi security scan",
  ],
});

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <>
      <BreadcrumbStructuredData
        items={[
          { name: "Home", path: "/" },
          { name: "Docs", path: "/docs" },
          { name: "Scanning a Site", path: "/docs/scanning" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title="Scanning a Site"
        description={DESCRIPTION}
        path="/docs/scanning"
        nonce={nonce}
      />
      {children}
    </>
  );
}
