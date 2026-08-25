import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Rate Limits: Per-Plan Request and Scan Caps",
  description:
    "Per-plan request and scan limits, the headers returned on every response, what happens when a limit is hit, and how to handle backoff.",
  path: "/docs/rate-limits",
  keywords: ["API rate limits", "scan limits"],
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
          { name: "Rate Limits", path: "/docs/rate-limits" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Rate Limits"}
        description={
          "Per-plan request and scan limits, the headers returned on every response, what happens when a limit is hit, and how to handle backoff."
        }
        path="/docs/rate-limits"
        nonce={nonce}
      />
      {children}
    </>
  );
}
