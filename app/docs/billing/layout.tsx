import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import {
  BreadcrumbStructuredData,
  TechArticleStructuredData,
} from "@/components/seo/structured-data";

const DESCRIPTION =
  "What each plan raises, how the three credit balances work, how to upgrade, cancel or reactivate a subscription, and what happens when a payment fails.";

export const metadata: Metadata = pageMetadata({
  title: "Plans and Billing: Limits, Credits, Cancelling",
  description: DESCRIPTION,
  path: "/docs/billing",
  keywords: ["plans", "billing", "cancel subscription", "scan credits"],
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
          { name: "Plans and Billing", path: "/docs/billing" },
        ]}
        nonce={nonce}
      />
      <TechArticleStructuredData
        title="Plans and Billing"
        description={DESCRIPTION}
        path="/docs/billing"
        nonce={nonce}
      />
      {children}
    </>
  );
}
