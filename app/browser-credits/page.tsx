import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";
import { CreditTopUpRoute } from "@/components/billing/credit-topup-route";

export const metadata: Metadata = privatePageMetadata(
  "Live-Browser Minutes",
  "/browser-credits",
);

export default function BrowserCreditsPage() {
  return <CreditTopUpRoute kindId="browser" />;
}
