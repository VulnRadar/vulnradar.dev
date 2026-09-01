import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const DESCRIPTION =
  "Why a scan failed, timed out, was refused, or returned nothing: what each scan status and error message means, and what to do about it.";

export const metadata: Metadata = pageMetadata({
  title: "Troubleshooting Scans: Failures, Timeouts, Empty Results",
  description: DESCRIPTION,
  path: "/docs/troubleshooting",
  keywords: ["scan failed", "scan timeout", "no findings", "blocked target"],
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
          { name: "Troubleshooting Scans", path: "/docs/troubleshooting" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title="Troubleshooting Scans"
        description={DESCRIPTION}
        path="/docs/troubleshooting"
        nonce={nonce}
      />
      {children}
    </>
  );
}
