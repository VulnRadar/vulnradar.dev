// Plan id -> display name. Mirrors lib/billing/catalog.ts in the main
// app (free -> "Free", core_supporter -> "Core Supporter", etc). The
// extension is a separate build target and cannot import from the main
// app's source tree, so this local map is the deliberate way to keep
// the same 4 known plan ids in sync with their real display names,
// not a workaround.

import type { Plan } from "./types";

export const PLAN_LABEL: Record<Plan, string> = {
  free: "Free",
  core_supporter: "Core Supporter",
  pro_supporter: "Pro Supporter",
  elite_supporter: "Elite Supporter",
};

export function planLabel(plan: Plan): string {
  return PLAN_LABEL[plan] ?? plan;
}
