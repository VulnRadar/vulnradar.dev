import type { Metadata } from "next";
import { headers } from "next/headers";
import { pageMetadata } from "@/lib/seo/metadata";
import { FaqStructuredData } from "@/components/seo/structured-data";
import { PRICING_FAQ } from "@/components/pricing/pricing-faq";
import {
  APP_NAME,
  BILLING_ENABLED,
  BILLING_PLAN_LIMITS,
} from "@/lib/config/constants";
import { getPaidPlans } from "@/lib/billing/plans";
import { PRICING_MODEL_FAQ } from "./pricing-model-faq";

// Cheapest paid plan, derived so the copy never drifts from the catalog.
const CHEAPEST_PAID = Math.min(...getPaidPlans().map((p) => p.priceInCents)) / 100;

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description: `${APP_NAME} pricing: a free tier with ${BILLING_PLAN_LIMITS.free} scans a day and no card, then paid plans from $${CHEAPEST_PAID} a month. Straightforward vulnerability assessment and management pricing, same detection engine on every plan.`,
  path: "/pricing",
  keywords: [
    "vulnerability scanner pricing",
    "vulnerability assessment pricing",
    "vulnerability assessment cost",
    "vulnerability management pricing",
    "vulnerability scanning service pricing",
    "web application scanning pricing",
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
  // Keep the FAQ rich result matched to whatever the page actually renders:
  // the Stripe-facing FAQ when billing is on, the pricing-model explainer when
  // it is off. Google penalises FAQ structured data that isn't visible on the
  // page, and the two branches show different copy.
  const faqItems = BILLING_ENABLED ? PRICING_FAQ : PRICING_MODEL_FAQ;
  return (
    <>
      <FaqStructuredData items={faqItems} nonce={nonce} />
      {children}
    </>
  );
}
