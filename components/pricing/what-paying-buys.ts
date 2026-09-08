import { BILLING_HISTORY_RETENTION } from "@/lib/config/client-constants";
import { PLANS } from "@/lib/billing/plans";

/**
 * What a paid plan actually gets you, as a noun phrase, derived from the
 * retention config the server enforces rather than typed in.
 *
 * Three separate places on /pricing told the reader that paying buys "a longer
 * history": the hero paragraph, the billing-off explainer, and the
 * pricing-model FAQ (which is also published as FAQPage JSON-LD). Every
 * CONFIG_BILLING_*_RETENTION is -1, meaning unlimited, on every plan including
 * free, so none of the three was true. It is the same defect AUDIT-014#mkt-08
 * removed from the plan cards and the same one that shipped "keeps results for
 * -1 days" to the live FAQ: retention is a config value, and copy that names it
 * has to read it.
 *
 * A plain .ts module, not a const inside one of the "use client" section
 * components, so the server-rendered FAQ data in app/pricing/pricing-model-faq.ts
 * can import the same string instead of keeping a fourth copy of the claim.
 */
export const EVERY_PLAN_KEEPS_HISTORY = PLANS.every(
  (plan) =>
    BILLING_HISTORY_RETENTION[
      plan.id as keyof typeof BILLING_HISTORY_RETENTION
    ] === -1,
);

/** Reads as the object of "paid plans raise ..." / "pay when you want ...". */
export const WHAT_PAYING_BUYS = EVERY_PLAN_KEEPS_HISTORY
  ? "more scans a day, more running at once, and higher API and team limits"
  : "more scans a day and a longer scan history";
