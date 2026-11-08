// Which other checks a /checks page should point at, because a reader landing
// on one of them has usually been handed a sibling's id in the same report.
//
// A module of its own so lib/seo/checks-content.ts stays JSON-only: the group
// table for PageChecks is declared on the detectors, so reading it loads them,
// and only the per-check page needs that.

import { LEGACY_DEDUPE_GROUPS } from "@/lib/scanner/dedupe";
import { pageCheckGroups } from "@/lib/scanner/checks/page-checks";
import { getCheckById, type SeoCheck } from "@/lib/seo/checks-content";

// Same precedence the engine merges with: dedupe.ts reads the PageCheck table
// before the legacy one.
const GROUP_OF: Readonly<Record<string, string>> = {
  ...LEGACY_DEDUPE_GROUPS,
  ...pageCheckGroups,
};

const GROUP_MEMBERS = new Map<string, string[]>();
for (const [id, group] of Object.entries(GROUP_OF)) {
  GROUP_MEMBERS.set(group, [...(GROUP_MEMBERS.get(group) ?? []), id]);
}

/**
 * Pairs that read like the same problem and are not, so the engine keeps them
 * apart and a page must not say they merge: sending a message to any origin
 * versus accepting one from any origin, and the same referrer mistake made in a
 * meta tag versus a header.
 */
export const RELATED_BUT_SEPARATE: readonly (readonly string[])[] = [
  [
    "postmessage-no-origin-check",
    "postmessage-star-origin",
    "postmessage-wildcard",
    "cs-postmessage-wildcard-origin",
  ],
  ["meta-referrer-unsafe", "referrer-policy-unsafe"],
];

export interface MergedSibling {
  id: string;
  /** Absent for a detector with no page of its own, which is shown as its id. */
  check?: SeoCheck;
}

export interface CheckSeeAlso {
  merged: MergedSibling[];
  related: SeoCheck[];
}

export function getCheckSeeAlso(check: SeoCheck): CheckSeeAlso {
  const group = GROUP_OF[check.id];
  const mergedIds = (group ? (GROUP_MEMBERS.get(group) ?? []) : []).filter(
    (id) => id !== check.id,
  );
  const merged = mergedIds.map((id) => {
    const sibling = getCheckById(id);
    return sibling ? { id, check: sibling } : { id };
  });

  const related = RELATED_BUT_SEPARATE.filter((family) =>
    family.includes(check.id),
  )
    .flat()
    .filter((id) => id !== check.id && !mergedIds.includes(id))
    .flatMap((id) => getCheckById(id) ?? []);

  return { merged, related };
}
