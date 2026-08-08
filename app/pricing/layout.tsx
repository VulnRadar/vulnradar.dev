import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { FaqStructuredData } from "@/components/seo/structured-data";
import { PRICING_FAQ } from "@/components/pricing/pricing-faq";
import { BILLING_PLAN_LIMITS } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description: `Free tier with ${BILLING_PLAN_LIMITS.free} scans a day, no card required. Paid plans raise the daily limit and extend how long results are kept. Same detection engine on every plan.`,
  path: "/pricing",
  keywords: [
    "vulnerability scanner pricing",
    "free security scanner",
    "web security scanner cost",
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
      <FaqStructuredData items={PRICING_FAQ} nonce={nonce} />
      {children}
    </>
  );
}
