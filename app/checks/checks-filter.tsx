"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/ui/utils";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
type Severity = (typeof SEVERITIES)[number];

/** Shown with no filter applied, and restored when the filter is cleared. */
const IDLE_STATUS = "Expand a category to jump straight to any single check.";

/**
 * Search and severity filter over the server-rendered check index.
 *
 * The index is ~750 links across 18 collapsed <details> blocks, and until now
 * the only way to find one check by name was to expand every accordion and use
 * browser find. "Show me every critical check" was unanswerable even though a
 * severity pill is rendered on every row.
 *
 * This filters the DOM the server already sent rather than taking the check
 * list as a prop. That is deliberate: /checks is the main organic surface and
 * every one of those links has to stay in the server HTML for crawlers, so
 * shipping a second copy of the same ~750 entries as an RSC payload would
 * roughly double the page's weight to buy nothing. Instead each row carries a
 * `data-check` haystack and a `data-severity`, and this only toggles `hidden`.
 *
 * With no query and no severity selected nothing is touched at all, so the
 * page behaves exactly as it did with JavaScript off.
 */
export function ChecksFilter({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [severities, setSeverities] = useState<Severity[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  // The result line is written from the same effect that does the filtering
  // rather than held in state: the count is a property of the DOM this effect
  // just mutated, and routing it back through setState would re-render the
  // whole island on every keystroke to say something it already knows.
  const statusRef = useRef<HTMLParagraphElement>(null);
  const inputId = useId();

  const active = query.trim().length > 0 || severities.length > 0;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const rows = root.querySelectorAll<HTMLElement>("[data-check]");
    const groups = root.querySelectorAll<HTMLDetailsElement>("details");

    if (!active) {
      rows.forEach((row) => {
        row.hidden = false;
      });
      groups.forEach((group) => {
        group.hidden = false;
        group.open = false;
        const badge = group.querySelector<HTMLElement>("[data-count]");
        if (badge) badge.textContent = badge.dataset.count ?? "";
      });
      if (statusRef.current) statusRef.current.textContent = IDLE_STATUS;
      return;
    }

    const needle = query.trim().toLowerCase();
    let total = 0;
    rows.forEach((row) => {
      const haystack = row.dataset.check ?? "";
      const severity = row.dataset.severity ?? "";
      const matches =
        (needle === "" || haystack.includes(needle)) &&
        (severities.length === 0 || severities.includes(severity as Severity));
      row.hidden = !matches;
      if (matches) total += 1;
    });

    groups.forEach((group) => {
      const visible = group.querySelectorAll<HTMLElement>(
        "[data-check]:not([hidden])",
      ).length;
      group.hidden = visible === 0;
      // Open every surviving group: a filtered result inside a collapsed
      // accordion is the same as no result.
      group.open = visible > 0;
      const badge = group.querySelector<HTMLElement>("[data-count]");
      if (badge) badge.textContent = String(visible);
    });

    if (statusRef.current) {
      statusRef.current.textContent =
        total === 0
          ? "No check matches that. Try a header name, a check id, or a single word."
          : `${total} matching ${total === 1 ? "check" : "checks"}.`;
    }
  }, [query, severities, active]);

  const toggleSeverity = useCallback((severity: Severity) => {
    setSeverities((current) =>
      current.includes(severity)
        ? current.filter((s) => s !== severity)
        : [...current, severity],
    );
  }, []);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:max-w-xs w-full">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor={inputId} className="sr-only">
            Filter checks by name or id
          </label>
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name or check id"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {SEVERITIES.map((severity) => {
            const on = severities.includes(severity);
            return (
              <button
                key={severity}
                type="button"
                onClick={() => toggleSeverity(severity)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs capitalize transition-colors",
                  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  on
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {severity}
              </button>
            );
          })}
        </div>
      </div>

      <p
        ref={statusRef}
        className="mt-3 text-sm text-muted-foreground"
        aria-live="polite"
      >
        {IDLE_STATUS}
      </p>

      <div ref={rootRef} className="mt-5 space-y-2">
        {children}
      </div>
    </div>
  );
}
