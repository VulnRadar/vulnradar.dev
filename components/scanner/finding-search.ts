import type { Vulnerability } from "@/lib/scanner/types";
import { CATEGORY_META } from "@/lib/scanner/category-meta";

/** Human label for a check category, falling back to the raw key. */
export function categoryLabel(cat: string): string {
  return (
    CATEGORY_META[cat as keyof typeof CATEGORY_META]?.label ||
    cat.replace(/-/g, " ")
  );
}

/**
 * What the findings-list search box matches against.
 *
 * It used to be title and description only. The check id was not searchable,
 * which is the one field the product sells as stable across runs: it is the
 * SARIF rule id, the key in every JSON export, and the address of each
 * /checks/{id} page. So the natural move, copying a rule id out of a CI
 * upload or a code-scanning alert and pasting it in to ask "did this fire
 * here too?", returned nothing, and the reader concluded the finding was
 * absent when it was on screen a scroll away.
 *
 * Category is matched both as the raw key and as its human label, so
 * "headers" finds the family whether the user types the slug or the name.
 *
 * An empty or whitespace-only query matches everything: the caller is
 * expected to skip filtering entirely in that case, and this keeps the two
 * consistent if it does not.
 */
export function findingMatchesQuery(
  finding: Pick<Vulnerability, "id" | "title" | "description" | "category">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    finding.title.toLowerCase().includes(q) ||
    finding.description.toLowerCase().includes(q) ||
    finding.id.toLowerCase().includes(q) ||
    finding.category.toLowerCase().includes(q) ||
    categoryLabel(finding.category).toLowerCase().includes(q)
  );
}
