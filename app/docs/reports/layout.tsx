import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Scan Report Exports and Compliance Mappings",
  description:
    "Export a scan as SARIF, PDF, Markdown, JSON, or a compliance crosswalk that maps findings to PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA, and GDPR controls.",
  path: "/docs/reports",
  keywords: [
    "SARIF export",
    "vulnerability compliance report",
    "PCI DSS SOC 2 ISO 27001 mapping",
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
          { name: "Reports & Compliance", path: "/docs/reports" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Reports & Compliance"}
        description={
          "Export a scan as SARIF, PDF, Markdown, JSON, or a compliance crosswalk that maps findings to PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA, and GDPR controls."
        }
        path="/docs/reports"
        nonce={nonce}
      />
      {children}
    </>
  );
}
