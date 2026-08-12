"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  APP_URL,
  DEMO_SCAN_LIMIT,
  TOTAL_CHECKS_LABEL,
} from "@/lib/config/constants";

interface DemoHeroProps {
  scansRemaining: number | null;
  onScan: () => void;
  isLoading?: boolean;
}

const FALLBACK_ORIGIN = APP_URL.replace(/\/$/, "");

export function DemoHero({ scansRemaining, onScan, isLoading }: DemoHeroProps) {
  // Resolved after mount so the server and the first client render agree.
  const [target, setTarget] = useState(FALLBACK_ORIGIN);

  useEffect(() => {
    setTarget(window.location.origin);
  }, []);

  return (
    <section className="pt-14 pb-12 sm:pt-20 sm:pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-start">
          <div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight mb-5 text-balance">
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
              onClick={onScan}
              disabled={isLoading}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {isLoading ? "Starting" : "Run scan"}
            </Button>

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
