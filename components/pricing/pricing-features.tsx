"use client";

import { Check, Minus } from "lucide-react";
import { PLANS } from "@/lib/billing/plans";
import { usePlanLimits, type AllPlanLimits } from "@/lib/hooks/use-plan-limits";
import {
  AI_USAGE_WINDOW_HOURS,
  BILLING_HISTORY_RETENTION,
  GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS,
} from "@/lib/config/client-constants";

type CellValue = boolean | string;

/** -1 means unlimited, 0 means the tier does not get the feature at all. */
function quota(n: number): CellValue {
  if (n === -1) return "Unlimited";
  if (n === 0) return false;
  return n.toLocaleString();
}

/**
 * aiTokensPerWindow is never -1 or 0 (see the PlanLimits doc comment in
 * lib/billing/catalog.ts), so this only needs the token count plus the
 * reset cadence, pulled from the same setting the API enforces so the
 * copy can't drift from it. Covers AI finding verification only -- chat
 * and AI scan summaries are free/unmetered on every plan (shown as their
 * own included row below). GitHub AI code review resets on this exact
 * same window through its own separate cap (see githubReviewQuota below).
 */
function aiUsageQuota(n: number): CellValue {
  return `${n.toLocaleString()} / ${AI_USAGE_WINDOW_HOURS}hr`;
}

/**
 * githubReviewTokensPerWindow: 0 means the tier has no token budget of its
 * own. That is NOT the same as "no access", and rendering a cross for it was
 * wrong: lib/billing/github-review-usage.ts gives a 0-budget plan one free
 * review every GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS, so the comparison table
 * was denying a capability Free actually has (AUDIT-011#drift-23). Say what
 * the user gets instead.
 */
function githubReviewQuota(n: number): CellValue {
  if (n === 0) {
    return `1 free review / ${GITHUB_REVIEW_FREE_TRIAL_WINDOW_HOURS}hr`;
  }
  return `${n.toLocaleString()} / ${AI_USAGE_WINDOW_HOURS}hr`;
}

function retention(planId: string): CellValue {
  const days =
    BILLING_HISTORY_RETENTION[planId as keyof typeof BILLING_HISTORY_RETENTION];
  if (days === undefined) return false;
  return days === -1 ? "Unlimited" : `${days} days`;
}

interface Row {
  label: string;
  values: CellValue[];
}

interface Section {
  title: string;
  rows: Row[];
}

/**
 * Every row's numbers come from `limits`, which usePlanLimits resolves from
 * the admin-editable BILLING_* settings the API actually enforces against.
 *
 * This table used to be built from lib/billing/catalog.ts's hardcoded PLANS[]
 * copy, under a comment claiming it "cannot drift from what the API actually
 * enforces". It could: enforcement resolves 48 registry settings
 * (lib/billing/plan-limits.ts), and any one admin edit desynchronised the
 * advertised number from the charged one, on the page where someone decides
 * what to pay (AUDIT-011#drift-10).
 */
function buildSections(limits: AllPlanLimits): Section[] {
  const each = (field: keyof AllPlanLimits[keyof AllPlanLimits]) =>
    PLANS.map((p) => limits[p.id][field]);

  return [
    {
      title: "Scanning",
      rows: [
        {
          label: "Scans per day",
          values: each("dailyScans").map(quota),
        },
        {
          label: "Scans running at once",
          values: each("concurrentScans").map(quota),
        },
        {
          label: "URLs per bulk request",
          values: each("bulkScanUrls").map(quota),
        },
        {
          // Enforced since crawl shipped, advertised nowhere until now: a user
          // met this cap as a 403 mid-crawl rather than as a plan difference
          // (AUDIT-011#drift-23).
          label: "Pages per crawl",
          values: each("crawlPages").map(quota),
        },
        {
          label: "Scheduled scans",
          values: each("scheduledScans").map(quota),
        },
        {
          label: "Scan history kept",
          values: PLANS.map((p) => retention(p.id)),
        },
      ],
    },
    {
      title: "AI",
      rows: [
        // "AI chat & AI scan summaries" used to sit here as four identical
        // ticks. So did "REST API and bearer tokens" below, and every row of an
        // "Included on every plan" section. A comparison table exists to make
        // differences findable, and a row that is the same in all four columns
        // is sixteen cells of noise between the reader and the rows that do
        // differ. They are stated once, in prose, in the strip under the plan
        // rail above (see UNIVERSAL in app/pricing/page.tsx).
        {
          label: "AI finding verification",
          values: each("aiTokensPerWindow").map(aiUsageQuota),
        },
        {
          label: "AI GitHub code review",
          values: each("githubReviewTokensPerWindow").map(githubReviewQuota),
        },
      ],
    },
    {
      title: "Live browser",
      rows: [
        {
          label: "Live-browser minutes/month",
          values: each("browserbaseMinutesPerMonth").map(quota),
        },
        {
          label: "Priority queue for live-browser sessions",
          values: PLANS.map((p) => p.id !== "free"),
        },
      ],
    },
    {
      title: "API & integrations",
      rows: [
        {
          label: "API requests per day",
          values: each("apiRequestsPerDay").map(quota),
        },
        { label: "API keys", values: each("apiKeys").map(quota) },
        {
          label: "Webhook endpoints",
          values: each("webhooks").map(quota),
        },
      ],
    },
    {
      title: "Team",
      rows: [
        {
          label: "Teams you can create",
          values: each("teams").map(quota),
        },
        {
          label: "Team members per team",
          values: each("teamMembers").map(quota),
        },
      ],
    },
  ];
}

function Cell({ value, label }: { value: CellValue; label: string }) {
  if (typeof value === "boolean") {
    return value ? (
      <>
        <Check className="h-4 w-4 text-primary mx-auto" aria-hidden="true" />
        <span className="sr-only">{`${label}: included`}</span>
      </>
    ) : (
      <>
        <Minus
          className="h-4 w-4 text-muted-foreground/40 mx-auto"
          aria-hidden="true"
        />
        <span className="sr-only">{`${label}: not included`}</span>
      </>
    );
  }
  return (
    <span
      className={
        value === "Unlimited"
          ? "text-sm font-medium text-primary tabular-nums"
          : "text-sm tabular-nums"
      }
    >
      {value}
    </span>
  );
}

export function PricingFeatures() {
  // Resolved from the same admin-editable settings the API enforces against,
  // falling back to the shipped catalog until the fetch lands.
  const sections = buildSections(usePlanLimits());

  return (
    <section id="compare" className="scroll-mt-20 border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="mb-8 max-w-xl">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-2">
            Line by line
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every limit that changes between plans, and nothing that does not.
            These are the limits this deployment enforces, read from the same
            settings the API checks against; your billing page is always the
            authority on what your own account gets.
          </p>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-sm min-w-[560px] border-collapse">
            <caption className="sr-only">Plan limits compared</caption>
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                <th
                  scope="col"
                  className="text-left px-5 py-3.5 font-medium text-muted-foreground w-[40%]"
                >
                  Limit
                </th>
                {PLANS.map((p) => (
                  <th
                    key={p.id}
                    scope="col"
                    className="px-4 py-3.5 font-semibold text-center text-foreground"
                  >
                    {p.name.replace(" Supporter", "")}
                  </th>
                ))}
              </tr>
            </thead>
            {sections.map((section) => (
              <tbody key={section.title}>
                <tr className="border-b border-border/40 bg-muted/10">
                  <th
                    scope="colgroup"
                    colSpan={PLANS.length + 1}
                    className="px-5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {section.title}
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-border/40 last:border-0 hover:bg-muted/20 transition-colors"
                  >
                    <th
                      scope="row"
                      className="px-5 py-3 text-muted-foreground font-normal text-left"
                    >
                      {row.label}
                    </th>
                    {row.values.map((v, j) => (
                      <td
                        key={j}
                        className="px-4 py-3 text-center text-foreground"
                      >
                        <Cell value={v} label={row.label} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </section>
  );
}
