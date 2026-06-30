const USE_CASES = [
  {
    audience: "Developers",
    situation:
      "You need to know if the thing you just shipped has obvious security holes, before the security team finds out the hard way.",
    features: [
      "Single-page scans during code review",
      "Stable IDs to reference in PR descriptions",
      "Copy-pasteable fixes for Nginx, Express, Next.js",
      "API key + one curl command for CI",
    ],
  },
  {
    audience: "Security teams",
    situation:
      "You need broad coverage across dozens of properties, not just the ones someone remembered to test.",
    features: [
      "Bulk scans across 1000 URLs at once",
      "Scheduled monitoring with webhook alerts",
      "Consistent severity ratings across the fleet",
      "Shareable report links for non-technical stakeholders",
    ],
  },
  {
    audience: "DevOps and platform engineers",
    situation:
      "You want security checks in the pipeline without adding a heavyweight tool that needs its own infrastructure.",
    features: [
      "Single REST endpoint, no agent to run",
      "GitHub Actions-compatible, plain JSON output",
      "Rate limits that don't break CI at scale",
      "Self-hostable if the SaaS isn't an option",
    ],
  },
];

export function LandingUseCases() {
  return (
    <section className="py-16 sm:py-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3 tracking-tight">
            Who uses VulnRadar
          </h2>
          <p className="text-muted-foreground max-w-xl leading-relaxed">
            The scanner is general-purpose, but these are the workflows it gets
            used for most.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4 min-w-0">
          {USE_CASES.map((uc, i) => (
            <div
              key={i}
              className="p-5 sm:p-6 rounded-xl border border-border/50 bg-card/50 hover:bg-card hover:border-border/70 transition-all flex flex-col"
            >
              <h3 className="text-base font-semibold mb-2">{uc.audience}</h3>
              <p className="text-sm text-muted-foreground mb-5 leading-relaxed flex-1">
                {uc.situation}
              </p>
              <ul className="space-y-1.5">
                {uc.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm">
                    <span className="text-primary shrink-0 mt-0.5 text-base leading-none select-none">
                      ·
                    </span>
                    <span className="text-muted-foreground leading-snug">
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
