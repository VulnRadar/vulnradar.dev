"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  APP_URL,
  DEMO_SCAN_LIMIT,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/client-constants";

interface DemoHeroProps {
  scansRemaining: number | null;
  /** Scans the given URL, or this deployment when called with no argument. */
  onScan: (url?: string) => void;
  isLoading?: boolean;
}

const FALLBACK_ORIGIN = APP_URL.replace(/\/$/, "");

export function DemoHero({ scansRemaining, onScan, isLoading }: DemoHeroProps) {
  // Resolved after mount so the server and the first client render agree.
  const [target, setTarget] = useState(FALLBACK_ORIGIN);
  const [ownUrl, setOwnUrl] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads window.location.origin (unavailable during SSR) to resolve the real value after hydration, per the comment above
    setTarget(window.location.origin);
  }, []);

  return (
    <section className="pt-14 pb-12 sm:pt-20 sm:pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-start">
          <div>
            {/* Tier A exactly (CLAUDE.md typography): the lg:text-5xl this
                carried was a fifth H1 size, and it made the hero title a
                different size from the one the same page shows while scanning,
                on an error, and over the report. */}
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-5 text-balance">
              Point it at us first.
            </h1>
            <p className="text-base sm:text-lg text-muted-foreground leading-relaxed text-pretty mb-8 max-w-xl">
              This runs the real scanner against {APP_NAME}&apos;s own
              deployment and shows you the whole report, including whatever we
              fail. Nothing is pre-rendered and nothing is filtered out to make
              us look better.
            </p>

            <Button
              size="lg"
              className="h-11 px-6 gap-2"
              onClick={() => onScan()}
              disabled={isLoading}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {isLoading ? "Starting" : "Run scan"}
            </Button>

            {/* Until now the demo could only ever scan our own deployment:
                the handler hardcoded window.location.origin even though the
                endpoint accepts any URL. Meanwhile ~780 SEO pages send their
                only call to action here, /tools/api-scanner promises "just
                paste the URL", and this page's own follow-up copy says "That
                was our site. Try yours." with nothing to type into. A visitor
                could not scan their own site without creating an account,
                which is the single biggest conversion gap for a tool of this
                shape. The endpoint already enforces a scheme allowlist, the
                admin blocklist, per-IP rate limiting and the full SSRF guard,
                so it needed no new protection to accept a typed URL. */}
            <form
              className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center"
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = ownUrl.trim();
                if (trimmed) onScan(trimmed);
              }}
            >
              <label htmlFor="demo-own-url" className="sr-only">
                Your website address
              </label>
              <input
                id="demo-own-url"
                type="text"
                inputMode="url"
                autoComplete="url"
                value={ownUrl}
                onChange={(e) => setOwnUrl(e.target.value)}
                placeholder="or scan your own: example.com"
                disabled={isLoading}
                /* focus-visible:outline-hidden removed the browser's own focus
                   ring without putting anything back, so keyboard users had no
                   indication at all that the demo's only text input was
                   focused. */
                className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:max-w-sm"
              />
              <Button
                type="submit"
                size="lg"
                variant="outline"
                className="h-11 px-5"
                disabled={isLoading || !ownUrl.trim()}
              >
                Scan it
              </Button>
            </form>

            {scansRemaining !== null && (
              <p className="text-sm text-muted-foreground mt-4 tabular-nums">
                {scansRemaining} of {DEMO_SCAN_LIMIT} demo scans left on this
                connection.
              </p>
            )}
          </div>

          <dl className="rounded-xl border border-border bg-card divide-y divide-border/50 text-sm">
            <div className="px-5 py-4">
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Target
              </dt>
              <dd className="font-mono text-foreground break-all">{target}</dd>
            </div>
            <div className="px-5 py-4">
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Checks
              </dt>
              <dd className="text-muted-foreground leading-relaxed">
                The full set, {TOTAL_CHECKS_LABEL}, same as a signed-in scan
              </dd>
            </div>
            <div className="px-5 py-4">
              <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
                Account
              </dt>
              <dd className="text-muted-foreground leading-relaxed">
                Not required. {DEMO_SCAN_LIMIT} runs per connection, then sign
                up to keep going.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
