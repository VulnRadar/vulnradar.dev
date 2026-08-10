const USE_CASES = [
  {
    audience: "Developers",
    situation:
      "You want to know whether the thing you just shipped has an obvious hole in it, before someone else tells you.",
    detail:
      "Scan a single page during review, quote the finding ID in the PR, paste the fix into your server config, and wire the same endpoint into CI with one curl call.",
  },
  {
    audience: "Security teams",
    situation:
      "You are responsible for every property the company owns, including the four nobody remembers.",
    detail:
      "Bulk scan up to 100 URLs in one request, schedule recurring runs with webhook alerts, and hand out share links that a non-engineer can read without a walkthrough.",
  },
  {
    audience: "Platform and DevOps",
    situation:
      "You want a security gate in the pipeline that does not become its own piece of infrastructure to maintain.",
    detail:
      "One REST endpoint, bearer token, plain JSON out. Nothing to deploy next to your app, rate limits that survive a monorepo, and a self-host path if the SaaS is a non-starter.",
  },
];

export function LandingUseCases() {
  return (
    <section className="py-16 sm:py-20 border-t border-border/50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-8">
          Who actually runs this
        </h2>

        <dl className="divide-y divide-border/50 border-y border-primary/20">
          {USE_CASES.map((uc) => (
            <div
              key={uc.audience}
              className="grid sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-2 sm:gap-8 py-6"
            >
              <dt className="text-sm font-semibold text-foreground sm:pt-0.5">
                {uc.audience}
              </dt>
              <dd className="space-y-2">
                <p className="text-foreground leading-relaxed">
                  {uc.situation}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {uc.detail}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
