import {
  CREDIT_KINDS,
  type CreditKindId,
} from "@/components/billing/credit-kinds";
import { PLANS, type PlanId, type PlanLimits } from "@/lib/billing/catalog";
import { limitLabel } from "@/lib/ui/plan-labels";
import { DocsTable } from "./docs-table";

/**
 * Plan and credit facts, rendered from the catalog. Typed by hand they went
 * wrong on four pages, because a wrong number compiles like a right one.
 */

/** Short names a page can use: "pro" reads better than "pro_supporter" in JSX. */
const PLAN_ALIASES = {
  core: "core_supporter",
  pro: "pro_supporter",
  elite: "elite_supporter",
} as const satisfies Record<string, PlanId>;

export type DocsPlanRef = PlanId | keyof typeof PLAN_ALIASES;

function planFor(ref: DocsPlanRef) {
  const id =
    ref in PLAN_ALIASES ? PLAN_ALIASES[ref as keyof typeof PLAN_ALIASES] : ref;
  const plan = PLANS.find((candidate) => candidate.id === id);
  if (!plan) throw new Error(`Unknown plan: ${ref}`);
  return plan;
}

/** One plan's limit, in words. */
export function DocsPlanValue({
  plan,
  limit,
}: {
  plan: DocsPlanRef;
  limit: keyof PlanLimits;
}) {
  return (
    <span className="tabular-nums">
      {limitLabel(planFor(plan).limits[limit])}
    </span>
  );
}

/** The cheapest plan a feature is on. */
export function DocsPlanTag({ min }: { min: DocsPlanRef }) {
  const plan = planFor(min);
  return (
    <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 align-middle text-[0.8em] font-medium text-primary">
      {plan.id === "free" ? "All plans" : `${plan.name} and up`}
    </span>
  );
}

/** A credit kind by its product name. */
export function DocsCreditName({ kind }: { kind: CreditKindId }) {
  return <>{CREDIT_KINDS[kind].name}</>;
}

export interface DocsLimitsRow {
  label: string;
  limit: keyof PlanLimits;
  /** Replaces a plan's cell where the number alone would mislead. */
  cells?: Partial<Record<PlanId, string>>;
}

/** One row per limit, one column per plan, from PLANS. Stacks on a phone. */
export function DocsLimitsTable({
  rows,
  caption,
  className,
}: {
  rows: DocsLimitsRow[];
  caption?: string;
  className?: string;
}) {
  return (
    <DocsTable
      caption={caption}
      className={className}
      columns={[
        { key: "limit", header: "Limit", className: "whitespace-nowrap" },
        ...PLANS.map((plan) => ({ key: plan.id, header: plan.name })),
      ]}
      data={rows.map((row) => ({
        limit: row.label,
        ...Object.fromEntries(
          PLANS.map((plan) => [
            plan.id,
            row.cells?.[plan.id] ?? limitLabel(plan.limits[row.limit]),
          ]),
        ),
      }))}
    />
  );
}
