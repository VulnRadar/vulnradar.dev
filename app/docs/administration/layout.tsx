import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const DESCRIPTION =
  "The operator's guide to the admin panel: staff roles and permissions, the settings registry, the audit log, impersonation, access rules, backups, broadcasts and retention.";

export const metadata: Metadata = pageMetadata({
  title: "Administration: Admin Panel, Settings, Backups",
  description: DESCRIPTION,
  path: "/docs/administration",
  keywords: ["admin panel", "staff roles", "audit log", "database backup"],
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
          { name: "Administration", path: "/docs/administration" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title="Administration"
        description={DESCRIPTION}
        path="/docs/administration"
        nonce={nonce}
      />
      {children}
    </>
  );
}
