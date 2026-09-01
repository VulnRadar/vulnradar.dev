import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const TITLE = "Browser Extension";
const DESCRIPTION =
  "Install the Chrome/Firefox extension, scan from the toolbar, auto-scan on navigation, and read on-page reputation alerts.";

export const metadata: Metadata = pageMetadata({
  title: "Browser Extension for Chrome and Firefox",
  description: DESCRIPTION,
  path: "/docs/extension",
  keywords: [
    "vulnradar browser extension",
    "chrome extension vulnerability scanner",
    "firefox extension security scanner",
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
          { name: TITLE, path: "/docs/extension" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={TITLE}
        description={DESCRIPTION}
        path="/docs/extension"
        nonce={nonce}
      />
      {children}
    </>
  );
}
