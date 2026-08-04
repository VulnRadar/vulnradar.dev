import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Rate Limits",
  description:
    "Per-plan request and scan limits, the headers returned on every response, what happens when a limit is hit, and how to handle backoff.",
  path: "/docs/rate-limits",
  keywords: ["API rate limits", "scan limits"],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbStructuredData
        items={[
          { name: "Docs", path: "/docs" },
          { name: "Rate Limits", path: "/docs/rate-limits" },
        ]}
      />
      <TechArticleStructuredData
        title={"Rate Limits"}
        description={
          "Per-plan request and scan limits, the headers returned on every response, what happens when a limit is hit, and how to handle backoff."
        }
        path="/docs/rate-limits"
      />
      {children}
    </>
  );
}
