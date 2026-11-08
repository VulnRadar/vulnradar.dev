import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/metadata";
import { APP_NAME, BILLING_PLAN_LIMITS } from "@/lib/config/constants";

export const metadata: Metadata = pageMetadata({
  title: "Create a Free Scanner Account, No Card",
  // A plain template with the sentinel handled after it, not a ternary inside:
  // scripts/knowledge/compile-features-knowledge.mjs reads this literal and can
  // only resolve simple interpolations, and -1 means unlimited.
  description:
    `Create a free ${APP_NAME} account. ${BILLING_PLAN_LIMITS.free} scans a day, full API access, and scan history kept for as long as your account is open. No card required.`.replace(
      "-1 scans a day",
      "Unlimited scans",
    ),
  path: "/signup",
  keywords: ["free security scanner account", "sign up vulnerability scanner"],
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
