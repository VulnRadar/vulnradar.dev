import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

export const metadata: Metadata = pageMetadata({
  title: "Two-Factor Auth, Sessions, and Account Privacy",
  description:
    "Turn on two-factor authentication, review and revoke active sessions and trusted devices, link OAuth providers, and export or delete your account data.",
  path: "/docs/account-security",
  keywords: [
    "two-factor authentication setup",
    "trusted device management",
    "account data export GDPR",
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
          { name: "Account Security", path: "/docs/account-security" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title={"Account Security"}
        description={
          "Turn on two-factor authentication, review and revoke active sessions and trusted devices, link OAuth providers, and export or delete your account data."
        }
        path="/docs/account-security"
        nonce={nonce}
      />
      {children}
    </>
  );
}
