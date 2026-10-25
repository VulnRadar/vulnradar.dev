import { STAFF_ROLE_HIERARCHY } from "@/lib/config/client-constants";

/**
 * Every role that carries any staff rank, highest first.
 *
 * Read off STAFF_ROLE_HIERARCHY rather than written out, because the staff
 * directory used to name four roles in a SQL literal and so never listed the
 * billing, security_analyst, content_manager or ops accounts that the same
 * tab invites. lib/billing/staff-plan.ts documents the same bug class on the
 * cancellation paths. A role added to the hierarchy now appears in the
 * directory without anyone remembering to touch a query.
 *
 * The four specialist roles share a tier, so ties are broken by name to keep
 * the order stable between requests.
 */
export function staffRolesByRank(): string[] {
  return Object.keys(STAFF_ROLE_HIERARCHY)
    .filter((role) => STAFF_ROLE_HIERARCHY[role] > 0)
    .sort(
      (a, b) =>
        STAFF_ROLE_HIERARCHY[b] - STAFF_ROLE_HIERARCHY[a] || a.localeCompare(b),
    );
}
