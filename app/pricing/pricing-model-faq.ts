import { APP_NAME } from "@/lib/config/constants";

// Honest, always-present pricing explainer shown on the billing-off branch of
// the pricing page (app/pricing/page.tsx). Data-only (no next/headers, not a
// client module) so both the server layout -- which emits it as matching FAQ
// JSON-LD with a CSP nonce -- and the client page can import it. Keeps the
// page carrying real, indexable content and the high-intent pricing keywords
// even when this deployment sells nothing. Written to be true for a free
// self-hosted instance: it describes the project's pricing model as reference,
// not an offer.
export const PRICING_MODEL_FAQ: { question: string; answer: string }[] = [
  {
    question: `Is ${APP_NAME} really free?`,
    answer:
      "Yes. It is open source under GPL-3.0, and a self-hosted instance like this one has no plan limits at all. On the hosted service there is also a free tier that needs no card.",
  },
  {
    question: `What does the hosted ${APP_NAME} vulnerability assessment cost?`,
    answer:
      "The hosted service is priced by scan volume, not per target: a free tier, then paid tiers that only raise daily scan quotas and history retention. The detection engine is identical on every tier.",
  },
  {
    question: "Do paid plans detect more vulnerabilities?",
    answer:
      "No. Vulnerability assessment and management pricing here buys capacity, not coverage. Every plan runs the same checks down to the check IDs.",
  },
];
