import { permanentRedirect } from "next/navigation";
import { CREDIT_KINDS } from "@/components/billing/credit-kinds";

/** Moved to /browser-credits. See app/checkout/credits/page.tsx for why the
 *  old path stays as a route rather than a config rule. */
export default function LegacyBrowserCreditsCheckout() {
  permanentRedirect(CREDIT_KINDS.browser.path);
}
