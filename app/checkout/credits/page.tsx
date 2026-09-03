import { permanentRedirect } from "next/navigation";
import { CREDIT_KINDS } from "@/components/billing/credit-kinds";

/**
 * AI credits moved to /ai-credits, named like its two siblings instead of
 * being the unnamed default inside the subscription checkout's namespace.
 *
 * This file has to stay, and has to stay a route rather than a config rule.
 * Two reasons. Bookmarks, Stripe receipts and the docs still name this URL, so
 * breaking it is a 404 on a link someone paid money through. And /checkout/
 * [productId] is a dynamic segment: without a static /checkout/credits sitting
 * in front of it, this path falls into the subscription checkout and renders
 * "That plan does not exist", which is worse than a 404 because it looks like
 * an answer.
 *
 * permanentRedirect, not redirect: 308, so the browser and any crawler treat
 * the new URL as the real one rather than re-resolving this every time.
 */
export default function LegacyAiCreditsCheckout() {
  permanentRedirect(CREDIT_KINDS.ai.path);
}
