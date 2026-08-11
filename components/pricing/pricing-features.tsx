import { Check, Minus } from "lucide-react";
import { PLANS } from "@/lib/billing/plans";
import {
  AI_USAGE_WINDOW_HOURS,
  BILLING_HISTORY_RETENTION,
} from "@/lib/config/constants";

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

/** githubReviewTokensPerWindow: 0 means the tier doesn't get the feature at all. */
function githubReviewQuota(n: number): CellValue {
  if (n === 0) return false;
  return `${n.toLocaleString()} / ${AI_USAGE_WINDOW_HOURS}hr`;
}

function retention(planId: string): CellValue {
  const days =
    BILLING_HISTORY_RETENTION[planId as keyof typeof BILLING_HISTORY_RETENTION];
  if (days === undefined) return false;
  return days === -1 ? "Unlimited" : `${days} days`;
}

const ROWS: { label: string; values: CellValue[] }[] = [
  {
    label: "Scans per day",
    values: PLANS.map((p) => quota(p.limits.dailyScans)),
  },
  {
    label: "API requests per day",
    values: PLANS.map((p) => quota(p.limits.apiRequestsPerDay)),
  },
  { label: "API keys", values: PLANS.map((p) => quota(p.limits.apiKeys)) },
  { label: "AI chat & AI scan summaries", values: PLANS.map(() => true) },
  {
    label: "AI finding verification",
    values: PLANS.map((p) => aiUsageQuota(p.limits.aiTokensPerWindow)),
  },
  {
    label: "AI GitHub code review",
    values: PLANS.map((p) =>
      githubReviewQuota(p.limits.githubReviewTokensPerWindow),
    ),
  },
  { label: "Scan history kept", values: PLANS.map((p) => retention(p.id)) },
  {
    label: "URLs per bulk request",
    values: PLANS.map((p) => quota(p.limits.bulkScanUrls)),
  },
  {
    label: "Scheduled scans",
    values: PLANS.map((p) => quota(p.limits.scheduledScans)),
  },
  {
    label: "Webhook endpoints",
    values: PLANS.map((p) => quota(p.limits.webhooks)),
  },
  {
    label: "Team members",
    values: PLANS.map((p) => quota(p.limits.teamMembers)),
  },
  { label: "Every scanner category", values: PLANS.map(() => true) },
  { label: "Stable finding IDs", values: PLANS.map(() => true) },
  { label: "REST API and bearer tokens", values: PLANS.map(() => true) },
  { label: "Self-hostable", values: PLANS.map(() => true) },
];

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
  return (
    <section className="border-t border-border/50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
        <div className="mb-8 max-w-xl">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight mb-2">
            Line by line
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            These numbers come straight out of the billing config, so this table
            cannot drift from what the API actually enforces.
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
            <tbody>
              {ROWS.map((row) => (
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
          </table>
        </div>
      </div>
    </section>
  );
}
