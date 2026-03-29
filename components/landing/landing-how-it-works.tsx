const STEPS = [
  { step: 1, title: "Enter your URL", desc: "Paste the URL of the website or application you want to scan." },
  { step: 2, title: "We analyze", desc: "Our engine performs comprehensive security checks across multiple categories." },
  { step: 3, title: "Get results", desc: "Review detailed findings with severity ratings and fix recommendations." },
]

export function LandingHowItWorks() {
  return (
    <section className="py-16 sm:py-20 border-y border-border/50 bg-muted/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="text-center mb-12">
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-2">How it works</p>
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
            Get started in minutes
          </h2>
          <p className="text-muted-foreground max-w-lg mx-auto">
            No complex setup required. Start scanning immediately.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 lg:gap-10">
          {STEPS.map((item, i) => (
            <div key={i} className="relative text-center">
              <div className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-primary text-primary-foreground text-lg font-bold mb-5">
                {item.step}
              </div>
              <h3 className="text-lg font-semibold mb-2">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              {i < 2 && (
                <div className="hidden md:block absolute top-5 left-[58%] w-[84%] h-px bg-border/60" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
