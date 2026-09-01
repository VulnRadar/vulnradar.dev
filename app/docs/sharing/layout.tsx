import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Share Scans, Public Reports, and Live Badges",
  description:
    "Share a scan as a read-only link, list it in the public directory, publish a per-host report, embed a live security badge, and diff two scans over time.",
  path: "/docs/sharing",
  keywords: [
    "share vulnerability scan",
    "public security report",
    "security badge embed",
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
          { name: "Home", path: "/landing" },
          { name: "Docs", path: "/docs" },
          { name: "Sharing & Public Pages", path: "/docs/sharing" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Sharing & Public Pages"}
        description={
          "Share a scan as a read-only link, list it in the public directory, publish a per-host report, embed a live security badge, and diff two scans over time."
        }
        path="/docs/sharing"
        nonce={nonce}
      />
      {children}
    </>
  );
}
