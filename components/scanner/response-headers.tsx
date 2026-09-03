"use client";

import { useId, useState } from "react";
import { ChevronDown, List } from "lucide-react";
import { cn } from "@/lib/ui/utils";

interface ResponseHeadersProps {
  headers: Record<string, string>;
}

// x-xss-protection is deliberately not on this list: the browser XSS
// auditor it controlled was removed from Chrome/Edge and never existed in
// Firefox (see the scanner's own "X-XSS-Protection Header Is Deprecated"
// finding), so its ABSENCE is the correct, recommended state today -- this
// checklist would otherwise dock a site for doing the right thing.
const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "cross-origin-embedder-policy",
  "x-dns-prefetch-control",
  "x-permitted-cross-domain-policies",
];

export function ResponseHeaders({ headers }: ResponseHeadersProps) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);

  const entries = Object.entries(headers);
  if (entries.length === 0) return null;

  const present = SECURITY_HEADERS.filter((h) =>
    entries.some(([k]) => k.toLowerCase() === h),
  );
  const missing = SECURITY_HEADERS.filter(
    (h) => !entries.some(([k]) => k.toLowerCase() === h),
  );
  const coverage = Math.round((present.length / SECURITY_HEADERS.length) * 100);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-hidden focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <List aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium text-foreground">
          Response headers
        </span>
        <span className="hidden h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted sm:block">
          <span
            className={cn(
              "block h-full rounded-full",
              coverage >= 70
                ? "bg-[hsl(var(--success))]"
                : coverage >= 40
                  ? "bg-[hsl(var(--severity-medium))]"
                  : "bg-[hsl(var(--severity-high))]",
            )}
            style={{ width: `${coverage}%` }}
          />
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {present.length}/{SECURITY_HEADERS.length} security headers
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border">
          <div className="flex flex-col gap-3 border-b border-border bg-muted/30 px-4 py-3">
            {present.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
                <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Set
                </span>
                {present.map((h) => (
                  <span
                    key={h}
                    className="rounded-md border border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/10 px-1.5 py-0.5 font-mono text-[11px] text-[hsl(var(--success))]"
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}
            {missing.length > 0 && (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
                <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Absent
                </span>
                {missing.map((h) => (
                  <span
                    key={h}
                    className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground line-through"
                  >
                    {h}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-80 overflow-auto">
            <dl className="divide-y divide-border">
              {entries.map(([key, value]) => {
                const isSecurity = SECURITY_HEADERS.includes(key.toLowerCase());
                return (
                  <div
                    key={key}
                    className={cn(
                      "grid gap-x-4 px-4 py-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]",
                      isSecurity && "bg-[hsl(var(--success))]/5",
                    )}
                  >
                    <dt className="break-all font-mono text-xs font-semibold text-foreground sm:text-right">
                      {key}
                    </dt>
                    <dd className="break-all font-mono text-xs text-muted-foreground">
                      {value}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
