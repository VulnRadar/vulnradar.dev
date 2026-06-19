const FAQ_ITEMS = [
  {
    q: "Can I cancel my subscription anytime?",
    a: "Yes, you can cancel at any time. You'll have access until the end of your billing period.",
  },
  {
    q: "What payment methods do you accept?",
    a: "We accept all major credit cards through Stripe, including Visa, Mastercard, and American Express.",
  },
  {
    q: "Is there a free trial for paid plans?",
    a: "We offer a generous free tier instead of a trial. Start with 25 scans/day free, then upgrade when you need more.",
  },
  {
    q: "Can I switch plans later?",
    a: "Absolutely. You can upgrade or downgrade your plan at any time. Changes take effect immediately.",
  },
  {
    q: "Do you offer refunds?",
    a: "All purchases are final. Please review your plan carefully before subscribing.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. We use industry-standard encryption and never store sensitive scan data longer than necessary.",
  },
];

export function PricingFaq() {
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
      <div className="text-center mb-10">
        <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">
          FAQ
        </p>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Frequently asked questions
        </h2>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {FAQ_ITEMS.map((faq, i) => (
          <div
            key={i}
            className="p-4 rounded-xl border border-border/50 bg-card/30"
          >
            <h3 className="font-medium text-sm mb-1.5">{faq.q}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {faq.a}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
