import { Lightbulb, Code2, ShieldAlert, Check, ArrowRight } from "lucide-react";
import { ROUTES } from "@/lib/config/constants";
import { Card } from "@/components/ui/card";
import Link from "next/link";

export function LandingSampleFinding() {
  return (
    <section className="py-16 sm:py-24 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 grid lg:grid-cols-2 gap-10 lg:gap-16 items-start min-w-0">
        <div>
          <p className="text-xs font-medium text-primary uppercase tracking-wider mb-3">
            What you get
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4 text-balance">
            Findings you can actually fix
          </h2>
          <p className="text-muted-foreground mb-6 text-pretty">
            Every report includes the evidence we collected, the risk in plain
            English, and step-by-step remediation. No &quot;informational
            severity 3.7&quot;. Just the title, the offending header, and the
            fix.
          </p>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-2 min-w-0">
              <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <span className="break-words">
                Stable check IDs (
                <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground">
                  hsts-missing
                </code>
                ) you can reference in CI, tickets, and changelogs.
              </span>
            </li>
            <li className="flex items-start gap-2 min-w-0">
              <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <span className="break-words">
                Evidence from the actual response, not a generated string
                pretending to be the response.
              </span>
            </li>
            <li className="flex items-start gap-2 min-w-0">
              <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <span className="break-words">
                Copy-pasteable fix examples for Next.js, Nginx, Apache, Caddy,
                Express, and more.
              </span>
            </li>
            <li className="flex items-start gap-2 min-w-0">
              <Check className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
              <span className="break-words">
                Re-running the same URL returns the same IDs and severities. No
                flakes, no churn.
              </span>
            </li>
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            The full report in your dashboard also includes compliance packs,
            diff against the previous scan, and per-finding assignment.
          </p>
          <Link
            href={ROUTES.DEMO}
            className="mt-6 inline-flex items-center text-sm font-medium text-primary hover:underline"
          >
            See a real report
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Link>
        </div>

        <Card className="overflow-hidden">
          <div className="px-4 sm:px-5 py-4 border-b border-border/60 bg-muted/20 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <ShieldAlert className="h-4 w-4 text-[hsl(var(--severity-high))] shrink-0" />
              <span className="text-sm font-mono font-medium truncate">
                hsts-missing
              </span>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border border-[hsl(var(--severity-high))]/40 bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] shrink-0">
              high
            </span>
          </div>

          <div className="p-4 sm:p-5 space-y-5">
            <div>
              <h3 className="text-lg font-semibold tracking-tight break-words">
                Missing HTTP Strict Transport Security (HSTS)
              </h3>
              <p className="text-sm text-muted-foreground mt-1 break-words">
                The server does not send the{" "}
                <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground break-all">
                  Strict-Transport-Security
                </code>{" "}
                header, which tells browsers to only connect via HTTPS.
                Attackers could intercept traffic via man-in-the-middle attacks
                by downgrading the connection from HTTPS to HTTP.
              </p>
            </div>

            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                <Code2 className="h-3.5 w-3.5" />
                Evidence
              </div>
              <pre className="rounded-lg border border-border/60 bg-muted/30 p-3 text-[11px] sm:text-xs font-mono overflow-x-auto">
                {`> GET / HTTP/1.1
> Host: example.com

< HTTP/1.1 200 OK
< Content-Type: text/html
< X-Frame-Options: SAMEORIGIN
< (no Strict-Transport-Security header)`}
              </pre>
            </div>

            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                <Lightbulb className="h-3.5 w-3.5" />
                Fix
              </div>
              <ol className="space-y-3 text-sm text-foreground/90">
                <li className="flex gap-3 min-w-0">
                  <span className="shrink-0 w-5 text-right text-muted-foreground tabular-nums pt-0.5">
                    1.
                  </span>
                  <span className="flex-1 min-w-0 break-words">
                    Add the{" "}
                    <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground break-all">
                      Strict-Transport-Security
                    </code>{" "}
                    header to all HTTPS responses.
                  </span>
                </li>
                <li className="flex gap-3 min-w-0">
                  <span className="shrink-0 w-5 text-right text-muted-foreground tabular-nums pt-0.5">
                    2.
                  </span>
                  <span className="flex-1 min-w-0 break-words">
                    Set a{" "}
                    <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground">
                      max-age
                    </code>{" "}
                    of at least 31536000 (1 year).
                  </span>
                </li>
                <li className="flex gap-3 min-w-0">
                  <span className="shrink-0 w-5 text-right text-muted-foreground tabular-nums pt-0.5">
                    3.
                  </span>
                  <span className="flex-1 min-w-0 break-words">
                    Consider adding{" "}
                    <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground">
                      includeSubDomains
                    </code>{" "}
                    and{" "}
                    <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground">
                      preload
                    </code>{" "}
                    directives.
                  </span>
                </li>
                <li className="flex gap-3 min-w-0">
                  <span className="shrink-0 w-5 text-right text-muted-foreground tabular-nums pt-0.5">
                    4.
                  </span>
                  <span className="flex-1 min-w-0 break-words">
                    Submit to{" "}
                    <a
                      href="https://hstspreload.org"
                      className="text-primary hover:underline"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      hstspreload.org
                    </a>{" "}
                    once stable.
                  </span>
                </li>
              </ol>
            </div>

            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Code examples
              </div>
              <pre className="rounded-lg border border-border/60 bg-muted/30 p-3 text-[11px] sm:text-xs font-mono overflow-x-auto">
                {`# Nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;`}
              </pre>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 text-xs text-muted-foreground pt-3 border-t border-border/60">
              <span>Re-runnable · stable ID</span>
              <span>Same URL → same result</span>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
