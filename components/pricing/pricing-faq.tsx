import {
  BILLING_HISTORY_RETENTION,
  BILLING_PLAN_LIMITS,
} from "@/lib/config/constants";

const FREE_SCANS = BILLING_PLAN_LIMITS.free;
const FREE_RETENTION = BILLING_HISTORY_RETENTION.free;

export const PRICING_FAQ: { question: string; answer: string }[] = [
  {
    question: "Can I cancel whenever I want?",
    answer:
      "Yes, from your profile, with no email to write. Your plan stays active until the end of the period you already paid for, then drops back to free.",
  },
  {
    question: "Is there a trial on the paid plans?",
    answer: `No, because the free tier is the trial. ${FREE_SCANS} scans a day with ${FREE_RETENTION} days of history, no card, for as long as you want. Upgrade when you hit the ceiling.`,
  },
  {
    question: "What happens if I switch plans mid-month?",
    answer:
      "The change applies immediately and Stripe prorates the difference. Upgrading raises your daily limit on the spot rather than at the next renewal.",
  },
  {
    question: "Do paid plans detect more than the free one?",
    answer:
      "No. The detection engine is identical on every plan, down to the check IDs. Paying raises quotas and retention, it does not unlock findings.",
  },
  {
    question: "Do you give refunds?",
    answer:
      "All purchases are final. The free tier exists so you can find out whether the tool works for you before any money changes hands.",
  },
  {
    question: "What payment methods work?",
    answer:
      "All major cards through Stripe. Card details go straight to Stripe and are never stored on our servers.",
  },
  {
    question: "What happens to my scan history if I downgrade?",
    answer: `Scans outside your new retention window stop being listed. On the free tier that means anything older than ${FREE_RETENTION} days.`,
  },
  {
    question: "Can I just self-host it instead?",
    answer:
      "Yes. It is GPL-3.0, the detection engine is in the same repo, and a self-hosted instance has no plan limits at all.",
  },
];

export function PricingFaq() {
  return (
    <section className="border-t border-border/50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-8">
          Before you enter a card
        </h2>

        <dl className="divide-y divide-border/50 border-t border-border/50">
          {PRICING_FAQ.map((faq) => (
            <div key={faq.question} className="py-6">
              <dt className="font-medium text-foreground mb-2 text-balance">
                {faq.question}
              </dt>
              <dd className="text-sm text-muted-foreground leading-relaxed">
                {faq.answer}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
