export function LandingHowItWorks() {
  return (
    <section className="py-16 sm:py-20 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-20 items-center">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-5">
              What actually happens during a scan
            </h2>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <p>
                When you submit a URL, the request goes from our servers, not
                your browser. That gives you a clean, reproducible view of what
                an external attacker would see, without your session cookies or
                local network getting in the way.
              </p>
              <p>
                The scanner sends the request through 12 independent modules in
                parallel: one checks the response headers, another inspects the
                TLS handshake, another resolves the DNS records, and so on.
                They don&apos;t wait for each other, which is how we get results
                in under 3 seconds despite running hundreds of checks.
              </p>
              <p>
                The findings come back with a stable ID (like{" "}
                <code className="text-xs px-1.5 py-0.5 rounded bg-muted text-foreground font-mono">
                  hsts-missing
                </code>
                ), the exact evidence from the response, and a severity the
                engine assigns the same way every time. Run it again tomorrow
                and you&apos;ll get the same IDs, or you&apos;ll see what
                changed.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {[
              {
                step: "Request",
                detail:
                  "Outbound from our servers. Clean external perspective, no session state.",
              },
              {
                step: "12 modules run in parallel",
                detail:
                  "Headers, TLS, DNS, cookies, content, secrets, CORS, config, and more. Concurrently.",
              },
              {
                step: "Deterministic output",
                detail:
                  "Stable IDs, stable severities. The findings match what you got last time, or the diff tells you exactly what changed.",
              },
              {
                step: "Under 3 seconds",
                detail:
                  "Most scans complete well under 3 seconds. DNS-heavy targets take slightly longer.",
              },
            ].map((item, i) => (
              <div
                key={i}
                className="flex gap-4 p-4 rounded-lg border border-border/50 bg-card/40"
              >
                <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mt-0.5">
                  <span className="text-[10px] font-bold text-primary">
                    {i + 1}
                  </span>
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground mb-0.5">
                    {item.step}
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
