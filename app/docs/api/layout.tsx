import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "REST API Reference: Endpoints and Schema",
  description:
    "REST API reference for the scanner: authentication, scan and bulk-scan endpoints, response schema, finding IDs, severity levels, and error codes.",
  path: "/docs/api",
  keywords: [
    "security scanner API",
    "vulnerability scanning API",
    "REST security API",
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
          { name: "API Reference", path: "/docs/api" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"API Reference"}
        description={
          "REST API reference for the scanner: authentication, scan and bulk-scan endpoints, response schema, finding IDs, severity levels, and error codes."
        }
        path="/docs/api"
        nonce={nonce}
      />
      {children}
    </>
  );
}
