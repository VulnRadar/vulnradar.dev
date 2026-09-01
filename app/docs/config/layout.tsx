import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Configuration Reference: Every Env Var",
  description:
    "Every configuration value: environment variables, feature flags, billing toggles, scan timeouts, retention windows, and SEO settings.",
  path: "/docs/config",
  keywords: ["scanner configuration", "environment variables reference"],
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
          { name: "Configuration Reference", path: "/docs/config" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Configuration Reference"}
        description={
          "Every configuration value: environment variables, feature flags, billing toggles, scan timeouts, retention windows, and SEO settings."
        }
        path="/docs/config"
        nonce={nonce}
      />
      {children}
    </>
  );
}
