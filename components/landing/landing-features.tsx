const ITEMS = [
  {
    title: "No agent to install",
    desc: "The scanner runs on our servers, not your machine. No browser extension, no proxy, no YAML config. Paste a URL and you're done.",
  },
  {
    title: "Same URL, same result",
    desc: "Every check is deterministic. Run the same scan twice and you get identical finding IDs, severities, and evidence. No randomness, no AI inference. That makes it safe to compare scans over time.",
  },
  {
    title: "Findings you can act on",
    desc: "Each result includes the exact header or response we flagged, a plain-English explanation, and copy-pasteable fix examples for Nginx, Express, Next.js, Caddy, and more.",
  },
  {
    title: "Built for automation",
    desc: "The dashboard uses the same API endpoint your CI pipeline does. Bearer token auth, JSON in, JSON out. One curl command and findings start flowing into your workflow.",
  },
];

export function LandingFeatures() {
  return (
    <section className="py-16 sm:py-20 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="max-w-xl mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
            What makes it different
          </h2>
          <p className="text-muted-foreground leading-relaxed">
            Most security scanners are either too shallow to be useful or too
            complicated to run. VulnRadar tries to sit in the gap: thorough
            enough to catch real issues, fast enough to run on every deploy.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-x-10 gap-y-0 divide-y divide-border/40 sm:divide-y-0">
          {ITEMS.map((item, i) => (
            <div
              key={i}
              className={`py-6 sm:py-0 sm:pb-8 ${i >= 2 ? "sm:pt-8 sm:border-t sm:border-border/40" : ""}`}
            >
              <h3 className="text-sm font-semibold text-foreground mb-2">
                {item.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
