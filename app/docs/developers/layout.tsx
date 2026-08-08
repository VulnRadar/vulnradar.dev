import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Developer Guide",
  description:
    "Extend the scanner: how detection checks are structured, how to add a new check category, the registry, and how findings and confidence scores are produced.",
  path: "/docs/developers",
  keywords: [
    "add security check",
    "extend vulnerability scanner",
    "security scanner development",
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
          { name: "Developer Guide", path: "/docs/developers" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Developer Guide"}
        description={
          "Extend the scanner: how detection checks are structured, how to add a new check category, the registry, and how findings and confidence scores are produced."
        }
        path="/docs/developers"
        nonce={nonce}
      />
      {children}
    </>
  );
}
