import { API, SEVERITY_LABELS } from "@/lib/config/client-constants";
import { plural } from "@/lib/ui/plural";

/**
 * Pure helpers behind the "Promoted rules" section of engine-feedback-manager.
 * They live in a plain .ts sibling because this project has no DOM test setup,
 * and the two things worth testing there (how a rule reads, and what removing
 * one sends) do not need a DOM.
 */

/** One row of GET API.ADMIN_PROMOTED_TAGS (lib/tags/promoted-rules.ts). */
export interface PromotedRuleEntry {
  id: number;
  tag: string;
  cwes: string[];
  categories: string[];
  requireBoth: boolean;
  minSeverity: string;
  minCount: number;
  createdBy: string | null;
  createdAt: string;
}

/**
 * What a rule matches, in a sentence an admin can check against what they
 * meant. Each list is any-of; whether a finding needs a hit in both lists or
 * either is the rule's require_both flag.
 *
 * A "both" rule with only one list can never match (a finding cannot have a
 * CWE the rule does not list), and the promote form lets an admin save one.
 * Saying so here is cheaper than a rule that sits in the list doing nothing.
 */
export function describeRuleMatch(
  rule: Pick<PromotedRuleEntry, "cwes" | "categories" | "requireBoth">,
): string {
  const parts: string[] = [];
  if (rule.cwes.length > 0) parts.push(rule.cwes.join(", "));
  if (rule.categories.length > 0) {
    const noun = plural(rule.categories.length, "category", "categories");
    parts.push(`${noun} ${rule.categories.join(", ")}`);
  }
  if (parts.length === 0) return "Nothing (the rule is empty)";
  const text = parts.join(rule.requireBoth ? " and " : " or ");
  if (rule.requireBoth && parts.length < 2) {
    return `${text} (needs both a CWE and a category, so it never matches)`;
  }
  return text;
}

/** The severity floor and how many matching findings it takes. */
export function describeRuleThreshold(
  rule: Pick<PromotedRuleEntry, "minSeverity" | "minCount">,
): string {
  const severity =
    SEVERITY_LABELS[rule.minSeverity as keyof typeof SEVERITY_LABELS] ??
    rule.minSeverity;
  const findings = plural(rule.minCount, "matching finding");
  return `${severity} or above, at least ${rule.minCount} ${findings}`;
}

/**
 * DELETE one rule. Throws with the server's own message on a refusal, because
 * the confirm dialog (components/shared/use-confirm.tsx) stays open and shows
 * whatever a rejected onConfirm throws, so a failed removal can never look
 * like a finished one.
 */
export async function removePromotedRule(id: number): Promise<void> {
  const res = await fetch(`${API.ADMIN_PROMOTED_TAGS}?id=${id}`, {
    method: "DELETE",
  });
  if (res.ok) return;
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  throw new Error(
    typeof data.error === "string" && data.error
      ? data.error
      : "Failed to remove the rule.",
  );
}
