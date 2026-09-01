import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Scheduled Scans for Recurring Website Audits",
  description:
    "Re-scan a URL automatically at hourly, 6-hourly, daily, weekly, or monthly cadence. Runs save to your scan history and fire webhooks and email alerts.",
  path: "/docs/scheduled-scans",
  keywords: [
    "scheduled vulnerability scan",
    "recurring security scan",
    "automated website monitoring",
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
          { name: "Scheduled Scans", path: "/docs/scheduled-scans" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Scheduled Scans"}
        description={
          "Re-scan a URL automatically at hourly, 6-hourly, daily, weekly, or monthly cadence. Runs save to your scan history and fire webhooks and email alerts."
        }
        path="/docs/scheduled-scans"
        nonce={nonce}
      />
      {children}
    </>
  );
}
