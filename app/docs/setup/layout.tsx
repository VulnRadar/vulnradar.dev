import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Setup Guide: Install and First Scan",
  description: `Install and configure ${APP_NAME}: prerequisites, environment variables, database migration, first run, and the checks to verify it worked.`,
  path: "/docs/setup",
  keywords: ["vulnerability scanner setup", "security scanner installation"],
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
          { name: "Setup Guide", path: "/docs/setup" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Setup Guide"}
        description={`Install and configure ${APP_NAME}: prerequisites, environment variables, database migration, and first run.`}
        path="/docs/setup"
        nonce={nonce}
      />
      {children}
    </>
  );
}
