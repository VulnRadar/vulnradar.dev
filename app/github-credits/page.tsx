import type { Metadata } from "next";
import { privatePageMetadata } from "@/lib/seo/metadata";
import { CreditTopUpRoute } from "@/components/billing/credit-topup-route";

export const metadata: Metadata = privatePageMetadata(
  "GitHub Review Credits",
  "/github-credits",
);

export default function GithubCreditsPage() {
  return <CreditTopUpRoute kindId="github" />;
}
