import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const DESCRIPTION =
  "Scan a connected GitHub repository's source for hardcoded secrets and AI-reviewed code flaws, then file the findings straight back as a GitHub issue.";

export const metadata: Metadata = pageMetadata({
  title: "GitHub Repository Scanning for Secrets and Code",
  description: DESCRIPTION,
  path: "/docs/github",
  keywords: [
    "GitHub repository scanner",
    "source code secret scanning",
    "AI code review security",
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
          { name: "Docs", path: "/docs" },
          { name: "GitHub Scanning", path: "/docs/github" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"GitHub Scanning"}
        description={DESCRIPTION}
        path="/docs/github"
        nonce={nonce}
      />
      {children}
    </>
  );
}
