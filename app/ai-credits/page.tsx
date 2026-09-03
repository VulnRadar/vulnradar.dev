import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";
import { CreditTopUpRoute } from "@/components/billing/credit-topup-route";

// Named, like its two siblings. This lived at /checkout/credits, where "AI"
// was the unnamed default and the URL read as a product called "credits"
// sitting inside the subscription checkout's own [productId] namespace.
export const metadata: Metadata = privatePageMetadata(
  "AI Credits",
  "/ai-credits",
);

export default function AiCreditsPage() {
  return <CreditTopUpRoute kindId="ai" />;
}
