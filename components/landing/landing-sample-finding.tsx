import { ArrowRight, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { ROUTES } from "@/lib/config/constants";

const EVIDENCE = `> GET / HTTP/1.1
> Host: example.com

< HTTP/1.1 200 OK
< Content-Type: text/html
< X-Frame-Options: SAMEORIGIN
< (no Strict-Transport-Security header)`;

const FIX = `# Nginx
add_header Strict-Transport-Security \\
  "max-age=63072000; includeSubDomains; preload" always;

# Express
res.setHeader('Strict-Transport-Security',
  'max-age=63072000; includeSubDomains');`;

const META: [string, string][] = [
  ["Category", "headers"],
  ["Check ID", "hsts-missing"],
  ["Severity", "high"],
];

export function LandingSampleFinding() {
  return (
    <section className="border-y border-border/50 bg-muted/30 py-16 sm:py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] gap-10 lg:gap-16 items-start">
          <div className="lg:pt-2">
            <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-4 text-balance">
              This is a finding, in full
            </h2>
            <div className="space-y-4 text-muted-foreground leading-relaxed">
              <p>
                Nothing is summarised away. You get the response we saw, the
                reason it is a problem, and the config change that closes it.
              </p>
              <p>
                Finding IDs are stable. Put{" "}
                <code className="font-mono text-xs px-1.5 py-0.5 rounded bg-background border border-border/60 text-foreground">
                  hsts-missing
                </code>{" "}
                in a PR description, a ticket, or a CI gate and it still
                resolves to the same check next month.
              </p>
            </div>
            <Link
              href={ROUTES.DEMO}
              className="inline-flex items-center gap-1.5 mt-6 text-sm font-medium text-primary hover:underline underline-offset-4 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              See a full report
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <article className="rounded-xl border border-border bg-card overflow-hidden min-w-0">
            <header className="px-5 py-4 border-b border-border/60 flex items-start gap-3">
              <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-[hsl(var(--severity-high))]" />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold tracking-tight text-balance">
                  Missing HTTP Strict Transport Security
                </h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  No{" "}
                  <code className="font-mono text-xs px-1 py-0.5 rounded bg-muted text-foreground">
                    Strict-Transport-Security
                  </code>{" "}
                  header on the response. Browsers get no instruction to stay on
                  HTTPS, so the first request of every session is downgradeable.
                </p>
              </div>
            </header>

            {/* a11y (SC 1.4.10): three fixed columns is about 100px each at a
                320px viewport, and each value is font-mono + truncate, so the
                sample finding's metadata simply disappeared at the narrow end
                and at 200% zoom. One column below sm, three from sm up; the
                divider flips axis with it so the rule still sits between
                cells rather than across them. */}
            <dl className="grid grid-cols-1 divide-y divide-border/60 border-b border-border/60 text-xs sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {META.map(([label, value]) => (
                <div key={label} className="px-4 py-3 min-w-0">
                  <dt className="text-muted-foreground mb-1">{label}</dt>
                  <dd className="font-mono text-foreground truncate">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="p-5 space-y-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                  Evidence
                </p>
                <pre className="rounded-lg border border-border/60 bg-muted/40 p-3 text-[11px] font-mono leading-5 overflow-x-auto">
                  <code>{EVIDENCE}</code>
                </pre>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                  Fix
                </p>
                <pre className="rounded-lg border border-border/60 bg-muted/40 p-3 text-[11px] font-mono leading-5 overflow-x-auto">
                  <code>{FIX}</code>
                </pre>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
