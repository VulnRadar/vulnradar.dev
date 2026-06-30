import { Lightbulb, Code2, ShieldAlert, ArrowRight } from "lucide-react";
import { ROUTES } from "@/lib/config/constants";
import { Card } from "@/components/ui/card";
import Link from "next/link";

export function LandingSampleFinding() {
  return (
    <section className="py-16 sm:py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-10 lg:gap-16 items-start">
          {/* Left: intro text */}
          <div className="lg:pt-2">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-4">
              Here is what a finding looks like
            </h2>
            <div className="space-y-3 text-muted-foreground leading-relaxed">
              <p>
                Every result includes the exact evidence from the HTTP response,
                a plain-English explanation of the risk, and specific fix
                instructions with code examples.
              </p>
              <p>
                Finding IDs are stable: the same URL always produces the same
                ID, so you can reference{" "}
                <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground">
                  hsts-missing
                </code>{" "}
                in a PR, a ticket, or a CI gate and it will still resolve next
                month.
              </p>
            </div>
            <Link
              href={ROUTES.DEMO}
              className="inline-flex items-center gap-1 mt-6 text-sm font-medium text-primary hover:underline"
            >
              See a real scan report
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {/* Right: finding card */}
          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b border-border/60 bg-muted/20 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <ShieldAlert className="h-4 w-4 text-[hsl(var(--severity-high))] shrink-0" />
                <span className="text-sm font-mono font-medium truncate">
                  hsts-missing
                </span>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border border-[hsl(var(--severity-high))]/40 bg-[hsl(var(--severity-high))]/10 text-[hsl(var(--severity-high))] shrink-0">
                high
              </span>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <h3 className="text-base font-semibold tracking-tight">
                  Missing HTTP Strict Transport Security (HSTS)
                </h3>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  The server does not send the{" "}
                  <code className="text-xs px-1 py-0.5 rounded bg-muted text-foreground">
                    Strict-Transport-Security
                  </code>{" "}
                  header. Without it, browsers have no instruction to enforce
                  HTTPS, leaving the door open for protocol-downgrade attacks.
                </p>
              </div>

              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  <Code2 className="h-3.5 w-3.5" />
                  Evidence
                </div>
                <pre className="rounded-lg border border-border/60 bg-muted/30 p-3 text-[11px] font-mono overflow-x-auto leading-5">
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
                <pre className="rounded-lg border border-border/60 bg-muted/30 p-3 text-[11px] font-mono overflow-x-auto leading-5">
                  {`# Nginx
add_header Strict-Transport-Security \\
  "max-age=63072000; includeSubDomains; preload" always;

# Express
res.setHeader('Strict-Transport-Security',
  'max-age=63072000; includeSubDomains');`}
                </pre>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/60">
                <span className="font-mono">hsts-missing</span>
                <span>Same URL, same finding ID, every time</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
