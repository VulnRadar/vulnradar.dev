import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";
import { APP_NAME } from "@/lib/config/constants";

const TITLE = "Command-Line Interface";
const DESCRIPTION = `Run a ${APP_NAME} scan from your terminal or CI and fail the build when critical or high findings cross a threshold you set.`;

export const metadata: Metadata = pageMetadata({
  title: "Command-Line Scanning and CI Gating",
  description: DESCRIPTION,
  path: "/docs/cli",
  keywords: ["vulnradar cli", "security scan in ci/cd", "ci security gate"],
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
          { name: "Home", path: "/" },
          { name: "Docs", path: "/docs" },
          { name: "CLI", path: "/docs/cli" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={TITLE}
        description={DESCRIPTION}
        path="/docs/cli"
        nonce={nonce}
      />
      {children}
    </>
  );
}
