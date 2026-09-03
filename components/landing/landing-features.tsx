const SUPPORTING = [
  {
    title: "Nothing to install",
    desc: "No agent, no sidecar container, no YAML. The scanner runs on our infrastructure against a URL you give it. A browser extension exists if you want one, but nothing has to be installed.",
  },
  {
    title: "Fixes, not lectures",
    desc: "Each finding ships with a config snippet for Nginx, Caddy, Express, and Next.js. Copy it, deploy, rescan, watch it disappear.",
  },
  {
    title: "The report an auditor asks for",
    desc: "Export the same scan as SARIF for the GitHub Security tab, or as a PCI DSS, SOC 2, ISO 27001, ASVS, HIPAA and GDPR crosswalk. Both on the free tier, and the crosswalk says which findings it could not map rather than forcing them into a control.",
  },
  {
    title: "The UI has no special API",
    desc: "The dashboard calls /api/v3/scan the same way your pipeline does. If you can see it in the interface, you can get it as JSON.",
  },
];

export function LandingFeatures() {
  return (
    <section className="py-16 sm:py-20 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] gap-8 lg:gap-14 items-start">
          {/* rounded-xl, not rounded-2xl: the radius ladder in CLAUDE.md tops
              out at xl for a page-level panel, and this was the only 2xl left
              on the marketing surfaces. */}
          <div className="rounded-xl border border-primary/20 bg-primary/10 p-6 sm:p-8">
            <p className="font-mono text-xs uppercase tracking-wider text-primary mb-4">
              The part that matters
            </p>
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4 text-balance">
              Run it twice, get the same answer twice
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Every check is deterministic. Same URL, same finding IDs, same
              severities, same evidence. There is no model in the detection path
              deciding today that something is medium when yesterday it was low.
            </p>
            <p className="text-muted-foreground leading-relaxed">
              That is what makes the diff between Tuesday and Friday readable,
              and it is what lets you fail a build on a specific ID without
              chasing false alarms every other week.
            </p>
          </div>

          <div className="divide-y divide-border/50">
            {SUPPORTING.map((item) => (
              <div key={item.title} className="py-5 first:pt-0 last:pb-0">
                <h3 className="text-sm font-semibold text-foreground mb-1.5">
                  {item.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
