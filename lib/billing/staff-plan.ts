// Staff plan grant/revoke -- the real, non-Stripe `users.plan` side effect
// of a staff role transition. Distinct from (and layered on top of) the
// dynamic-limits safety net in lib/rate-limiting/daily-limits.ts and
// lib/billing/plan-limits.ts, which still resolves a "staff" caller to the
// Pro Supporter plan's numeric limits regardless of what `users.plan`
// literally says at any given moment (e.g. covers the instant before this
// module's UPDATE has run, or a self-hosted deployment with billing off).
//
// Policy (see scripts/migrate/versions/2.0.0-to-3.0.0.mjs's header comment
// on users.pre_staff_plan for the schema side of this):
//   - Promoted INTO a staff role (admin/moderator/support) while on
//     free/core_supporter/pro_supporter: bumped to pro_supporter for real,
//     for free, no Stripe subscription/customer/charge involved. The prior
//     plan is saved in pre_staff_plan, but only the first time (repeated
//     promote/demote cycles, or a change between two staff roles, never
//     clobber the true original value).
//   - Promoted INTO a staff role while already on elite_supporter (above
//     Pro): left untouched. They keep what they have; pre_staff_plan stays
//     NULL, since nothing was granted.
//   - Demoted OUT of every staff role back to a regular user: if
//     pre_staff_plan is set (a grant happened), plan is instantly restored
//     to it and pre_staff_plan is cleared -- UNLESS the current plan
//     already ranks higher than pre_staff_plan, meaning a real purchase
//     (e.g. upgrading to elite_supporter via checkout) moved them past the
//     granted floor while they were still staff. In that case the real,
//     paid plan is kept as-is (only pre_staff_plan is cleared) -- losing
//     staff should never cost someone a subscription they're actively
//     paying for. If pre_staff_plan is NULL (they were already
//     elite_supporter when promoted, so nothing was ever granted), nothing
//     happens to plan either way.
//   - A change between two staff roles (e.g. admin -> moderator) never
//     touches plan at all -- the staff/non-staff boundary was never
//     crossed, so there is nothing to grant or revoke. EXCEPT super_admin,
//     which grants elite_supporter instead of pro_supporter (a real tier
//     change even though both ends are "staff") -- see grantedPlanForRole.
//     admin <-> super_admin therefore DOES re-grant, stepping the literal
//     plan column up or down between the two tiers.
//
// Callers: every place app/api/v3/admin/route.ts actually writes
// users.role (the "set_role", "make_admin", and "remove_admin" actions),
// plus instrumentation.ts's boot-time super_admin bootstrap.

import pool from "@/lib/database/db";
import { STAFF_ROLES } from "@/lib/rate-limiting/daily-limits";
import { planRank } from "@/lib/billing/plan-limits";

const GRANTED_PLAN = "pro_supporter";
/** super_admin gets a tier above the rest of staff -- see this file's header. */
const SUPER_ADMIN_GRANTED_PLAN = "elite_supporter";

/**
 * Plans below the granted tier that get bumped up on promotion. Reused for
 * both grant tiers: everything below Pro Supporter is also everything below
 * Elite Supporter, since no plan sits between the two.
 */
const GRANT_ELIGIBLE_PLANS = new Set([
  "free",
  "core_supporter",
  "pro_supporter",
]);

function grantedPlanForRole(role: string | null | undefined): string {
  return role === "super_admin" ? SUPER_ADMIN_GRANTED_PLAN : GRANTED_PLAN;
}

function isStaffRoleForPlanGrant(role: string | null | undefined): boolean {
  return !!role && (STAFF_ROLES.includes(role) || role === "super_admin");
}

/**
 * The plan a cancelled or lapsed subscription falls back to, as a SQL CASE
 * over `users.role`, plus the role array it needs bound.
 *
 * The three cancellation paths (the Stripe webhook's
 * customer.subscription.deleted, POST /api/v3/billing/subscription/cancel,
 * and POST /api/v3/billing's cancel_immediately) each hand-wrote
 * `role IN ('admin', 'moderator', 'support')`. That covered three of the
 * seven roles in STAFF_ROLES, so a billing/security_analyst/content_manager/
 * ops account dropped to free instead of the pro_supporter floor its role
 * grants, and super_admin -- whose floor is elite_supporter -- was in none of
 * the lists at all. Deriving the CASE from the same constants
 * grantStaffPlan uses means the policy cannot drift again when a role is
 * added.
 *
 * `roleParam` is the placeholder the caller binds STAFF_ROLE_FLOOR_ROLES to,
 * e.g. "$2". The plan literals are module constants, never caller input.
 */
export const STAFF_PLAN_FLOOR_ROLES: readonly string[] = STAFF_ROLES;

export function staffPlanFloorCase(roleParam: string): string {
  return (
    `CASE WHEN role = 'super_admin' THEN '${SUPER_ADMIN_GRANTED_PLAN}' ` +
    `WHEN role = ANY(${roleParam}::text[]) THEN '${GRANTED_PLAN}' ` +
    `ELSE 'free' END`
  );
}

export async function grantStaffPlan(
  userId: number,
  role: string | null | undefined,
): Promise<void> {
  const result = await pool.query<{
    plan: string | null;
    pre_staff_plan: string | null;
  }>("SELECT plan, pre_staff_plan FROM users WHERE id = $1", [userId]);
  const row = result.rows[0];
  if (!row) return;

  const targetPlan = grantedPlanForRole(role);

  if (row.pre_staff_plan !== null) {
    // Already grant-managed -- either a repeated promote/demote cycle, or a
    // tier change between two staff roles (e.g. admin -> super_admin, see
    // syncPlanForRoleChange). The eligibility check below exists only to
    // protect a genuine purchase made from OUTSIDE staff before ever being
    // promoted; once pre_staff_plan is tracking that true original, `plan`
    // itself is ours to move between tiers freely -- checking it against
    // GRANT_ELIGIBLE_PLANS here would wrongly treat the PREVIOUS grant's
    // own tier (e.g. elite_supporter, from having been super_admin) as an
    // untouchable real purchase and refuse to step it back down.
    await pool.query(
      "UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2",
      [targetPlan, userId],
    );
    return;
  }

  const currentPlan = row.plan || "free";
  if (!GRANT_ELIGIBLE_PLANS.has(currentPlan)) {
    // Already above Pro (elite_supporter) -- they keep it, nothing to grant.
    return;
  }

  // First promotion (or the prior grant cycle was fully reverted, which
  // clears pre_staff_plan back to NULL): remember the real plan so it can
  // be restored later.
  await pool.query(
    "UPDATE users SET plan = $1, pre_staff_plan = $2, updated_at = NOW() WHERE id = $3",
    [targetPlan, currentPlan, userId],
  );
}

async function revokeStaffPlan(
  userId: number,
  role: string | null | undefined,
): Promise<void> {
  const result = await pool.query<{
    plan: string | null;
    pre_staff_plan: string | null;
  }>("SELECT plan, pre_staff_plan FROM users WHERE id = $1", [userId]);
  const row = result.rows[0];
  const preStaffPlan = row?.pre_staff_plan;
  if (!preStaffPlan) return; // never granted -- they were already elite_supporter

  const currentPlan = row?.plan || "free";
  const grantedPlan = grantedPlanForRole(role);
  if (planRank(currentPlan) > planRank(grantedPlan)) {
    // Compare against the plan THIS role's grant would have set (pro_supporter,
    // or elite_supporter for super_admin), not preStaffPlan: preStaffPlan is
    // always at or below that rank by construction (GRANT_ELIGIBLE_PLANS caps
    // it there), so comparing against it directly would fire on almost every
    // ordinary demotion, not just a real upgrade. This module only ever sets
    // `plan` to exactly the granted tier, so the current plan ranking ABOVE
    // that can only mean something else (a real purchase/upgrade, e.g.
    // checkout to elite_supporter) moved them past the grant while they were
    // staff. Don't revert past a purchase they're actively paying for: keep
    // the current plan, just clear the bookkeeping column since there's
    // nothing left to restore.
    await pool.query(
      "UPDATE users SET pre_staff_plan = NULL, updated_at = NOW() WHERE id = $1",
      [userId],
    );
    return;
  }

  await pool.query(
    "UPDATE users SET plan = $1, pre_staff_plan = NULL, updated_at = NOW() WHERE id = $2",
    [preStaffPlan, userId],
  );
}

/**
 * Keeps pre_staff_plan consistent when an admin manually overrides a
 * CURRENTLY-STAFF user's plan via the separate "update_plan" action
 * (app/api/v3/admin/route.ts), which writes users.plan directly and knows
 * nothing about this module's bookkeeping. Left alone, two bugs follow
 * once the user eventually leaves staff and revokeStaffPlan runs:
 *   - Manual bump ABOVE the grant (e.g. free -> elite_supporter): treated
 *     like a real purchase, so revokeStaffPlan just clears pre_staff_plan
 *     and keeps the plan -- but pre_staff_plan still held the user's real
 *     original plan (e.g. "free"), permanently discarded, even though the
 *     bump was a manual override, not an actual Stripe purchase.
 *   - Manual drop AT/BELOW the grant (e.g. back to "free" as a
 *     correction): pre_staff_plan still holds the OLD original value, so
 *     revokeStaffPlan later restores that instead of the admin's edit,
 *     silently reverting it.
 *
 * No-ops for a non-staff target (pre_staff_plan has nothing to do there)
 * or a staff target with no grant on record (pre_staff_plan already
 * NULL -- they were elite_supporter when promoted, nothing was granted,
 * this manual change is exactly as real as any other admin plan edit).
 */
export async function syncPreStaffPlanForManualPlanChange(
  userId: number,
  targetRole: string | null | undefined,
  newPlan: string,
): Promise<void> {
  if (!isStaffRoleForPlanGrant(targetRole)) return;

  const result = await pool.query<{ pre_staff_plan: string | null }>(
    "SELECT pre_staff_plan FROM users WHERE id = $1",
    [userId],
  );
  if (!result.rows[0]?.pre_staff_plan) return;

  if (planRank(newPlan) > planRank(grantedPlanForRole(targetRole))) {
    // Same call revokeStaffPlan already makes for a real Stripe purchase
    // past the grant: nothing left to restore to that beats what they
    // have now.
    await pool.query(
      "UPDATE users SET pre_staff_plan = NULL, updated_at = NOW() WHERE id = $1",
      [userId],
    );
  } else {
    // At or below the grant: this IS the new "true" plan to restore once
    // they leave staff -- same shape grantStaffPlan itself writes on a
    // first promotion. users.plan showing this (rather than
    // pro_supporter) while still staff doesn't under-provision them: the
    // dynamic-limits safety net this file's header comment describes
    // still resolves a staff caller to Pro Supporter's numeric limits
    // regardless of the literal plan column.
    await pool.query(
      "UPDATE users SET pre_staff_plan = $1, updated_at = NOW() WHERE id = $2",
      [newPlan, userId],
    );
  }
}

/**
 * Reacts to a users.role change by granting or revoking the real staff
 * plan floor. No-ops entirely unless the change actually crosses the
 * staff/non-staff boundary, OR crosses the super_admin/other-staff boundary
 * (a real tier change, pro_supporter <-> elite_supporter, even though both
 * ends count as "staff") -- pass the row's role from BEFORE the UPDATE
 * (oldRole) and the role it was just changed to (newRole).
 */
export async function syncPlanForRoleChange(
  userId: number,
  oldRole: string | null | undefined,
  newRole: string | null | undefined,
): Promise<void> {
  const wasStaff = isStaffRoleForPlanGrant(oldRole);
  const isStaff = isStaffRoleForPlanGrant(newRole);
  const tierChanged =
    (oldRole === "super_admin") !== (newRole === "super_admin");
  if (wasStaff === isStaff && !tierChanged) return;

  if (isStaff) {
    await grantStaffPlan(userId, newRole);
  } else {
    await revokeStaffPlan(userId, oldRole);
  }
}

/**
 * Self-healing sweep for staff roles assigned by directly editing
 * users.role in the database -- e.g. hand-run SQL to bootstrap a
 * super_admin on an existing account -- which bypasses the only two code
 * paths that normally call grantStaffPlan (app/api/v3/admin/route.ts's
 * set_role/make_admin, and instrumentation.ts's own super_admin bootstrap
 * above). Without this, that account keeps role='super_admin' but
 * plan='free' forever, since nothing ever ran the grant.
 *
 * Called on every boot (see instrumentation.ts). Safe to run repeatedly:
 * only touches a staff-role row with pre_staff_plan still NULL (never
 * grant-managed) whose current plan is still in GRANT_ELIGIBLE_PLANS --
 * grantStaffPlan itself is idempotent and already refuses to touch anyone
 * genuinely above the grant tier (a real purchase), so this can never
 * downgrade or clobber a paid plan.
 */
export async function reconcileStaffPlans(): Promise<number> {
  const result = await pool.query<{
    id: number;
    role: string;
    plan: string | null;
  }>(
    `SELECT id, role, plan FROM users
     WHERE role = ANY($1::text[]) AND pre_staff_plan IS NULL`,
    [[...STAFF_ROLES, "super_admin"]],
  );

  let reconciled = 0;
  for (const row of result.rows) {
    if (!GRANT_ELIGIBLE_PLANS.has(row.plan || "free")) continue;
    await grantStaffPlan(row.id, row.role);
    reconciled++;
  }
  return reconciled;
}
