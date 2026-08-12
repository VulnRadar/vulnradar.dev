"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/lib/config/constants";

interface DemoErrorProps {
  error: string;
  details?: string;
  onRetry: () => void;
}

export function DemoError({ error, details, onRetry }: DemoErrorProps) {
  const isBlocked = error === "This target cannot be scanned.";

  return (
    <section className="pt-16 pb-20 sm:pt-24">
      <div className="max-w-2xl mx-auto px-4 sm:px-6">
        <p className="font-mono text-xs uppercase tracking-wider text-destructive mb-3">
          {isBlocked ? "Target refused" : "Scan failed"}
        </p>

        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-3 text-balance">
          {isBlocked ? "That target is off limits" : "The scan did not finish"}
        </h1>

        <p className="text-muted-foreground leading-relaxed mb-6">{error}</p>

        {details && (
          <div className="rounded-lg border border-border/50 bg-muted/30 px-4 py-3 mb-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {details}
            </p>
          </div>
        )}

        <Button onClick={onRetry} className="gap-2">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Run scan again
        </Button>

        {isBlocked && (
          <p className="text-sm text-muted-foreground mt-6">
            If you think this target should be allowed, mail{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="text-primary hover:underline underline-offset-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        )}
      </div>
    </section>
  );
}
