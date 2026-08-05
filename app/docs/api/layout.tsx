import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "API Reference",
  description:
    "REST API reference for the scanner: authentication, scan and bulk-scan endpoints, response schema, finding IDs, severity levels, and error codes.",
  path: "/docs/api",
  keywords: [
    "security scanner API",
    "vulnerability scanning API",
    "REST security API",
  ],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbStructuredData
        items={[
          { name: "Docs", path: "/docs" },
          { name: "API Reference", path: "/docs/api" },
        ]}
      />
      <TechArticleStructuredData
        title={"API Reference"}
        description={
          "REST API reference for the scanner: authentication, scan and bulk-scan endpoints, response schema, finding IDs, severity levels, and error codes."
        }
        path="/docs/api"
      />
      {children}
    </>
  );
}
