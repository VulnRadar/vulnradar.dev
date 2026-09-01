import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME } from "@/lib/config/constants";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Self-Hosting Guide: Deploy Your Own Instance",
  description: `Run your own ${APP_NAME} instance under GPL-3.0. Covers deployment, database setup, SMTP, environment configuration, and upgrades.`,
  path: "/docs/self-hosting",
  keywords: [
    "self-hosted vulnerability scanner",
    "self-host security scanner",
    "open source scanner hosting",
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
          { name: "Self-Hosting Guide", path: "/docs/self-hosting" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Self-Hosting Guide"}
        description={`Run your own ${APP_NAME} instance under GPL-3.0. Covers deployment, database setup, SMTP, environment configuration, and upgrades.`}
        path="/docs/self-hosting"
        nonce={nonce}
      />
      {children}
    </>
  );
}
