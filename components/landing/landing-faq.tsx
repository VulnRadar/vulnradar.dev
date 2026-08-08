export interface FaqItem {
  question: string;
  answer: string;
}

interface LandingFaqProps {
  items: FaqItem[];
}

export function LandingFaq({ items }: LandingFaqProps) {
  return (
    <section className="py-16 sm:py-20 border-t border-border/50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-8">
          Questions people ask first
        </h2>

        <dl className="divide-y divide-border/50 border-t border-border/50">
          {items.map((item) => (
            <div key={item.question} className="py-6">
              <dt className="font-medium text-foreground mb-2 text-balance">
                {item.question}
              </dt>
              <dd className="text-sm text-muted-foreground leading-relaxed">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
