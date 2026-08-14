/**
 * Tests for lib/billing/staff-plan.ts's syncPlanForRoleChange -- the real,
 * non-Stripe users.plan grant/revoke that now accompanies a staff role
 * transition (admin/moderator/support), distinct from (and layered on top
 * of) the dynamic-limits safety net in lib/rate-limiting/daily-limits.ts
 * and lib/billing/plan-limits.ts, which those files' own suites already
 * cover.
 *
 * Per this repo's mocking rule (mock at the network/DB boundary, not below
 * it — see tests/README.md), pool.query is mocked and the real
 * grant/revoke logic runs against it. STAFF_ROLES is imported for real
 * from lib/rate-limiting/daily-limits.ts (a plain array constant, nothing
 * to mock) so this suite can never silently drift from the actual staff
 * role set the route layer uses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const {
  syncPlanForRoleChange,
  syncPreStaffPlanForManualPlanChange,
  reconcileStaffPlans,
} = await import("@/lib/billing/staff-plan");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("syncPlanForRoleChange — no-ops when the staff/non-staff boundary is not crossed", () => {
  it("does nothing for a change between two non-staff-relevant states (user -> user)", async () => {
    await syncPlanForRoleChange(5, "user", "user");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does nothing for a change between two staff roles (admin -> moderator)", async () => {
    await syncPlanForRoleChange(5, "admin", "moderator");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does nothing for a change between two staff roles (moderator -> support)", async () => {
    await syncPlanForRoleChange(5, "moderator", "support");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("syncPlanForRoleChange — promotion into staff (grant)", () => {
  it("bumps a free-plan user to pro_supporter and records the original plan", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", pre_staff_plan: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "user", "admin");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE users SET plan = \$1, pre_staff_plan/);
    expect(updateParams).toEqual(["pro_supporter", "free", 5]);
  });

  it("bumps a core_supporter user to pro_supporter", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "core_supporter", pre_staff_plan: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "user", "moderator");

    const [, updateParams] = mockQuery.mock.calls[1];
    expect(updateParams).toEqual(["pro_supporter", "core_supporter", 5]);
  });

  it("re-applies pro_supporter for an already-pro_supporter user (still eligible, still a grant)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", pre_staff_plan: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "user", "support");

    const [, updateParams] = mockQuery.mock.calls[1];
    expect(updateParams).toEqual(["pro_supporter", "pro_supporter", 5]);
  });

  it("leaves an elite_supporter user's plan untouched -- they keep what they have", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "elite_supporter", pre_staff_plan: null }],
    });

    await syncPlanForRoleChange(5, "user", "admin");

    // Only the SELECT ran -- no UPDATE, since nothing above Pro gets touched.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("never overwrites an already-recorded pre_staff_plan on a repeated promote/demote cycle", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", pre_staff_plan: "free" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "user", "admin");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    // Only plan is set -- pre_staff_plan is not part of this statement at all.
    expect(updateSql).not.toContain("pre_staff_plan");
    expect(updateParams).toEqual(["pro_supporter", 5]);
  });

  it("does nothing further when the target user row does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(999, "user", "admin");

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("syncPlanForRoleChange — demotion out of staff (revoke)", () => {
  it("instantly restores the original plan and clears pre_staff_plan when the grant was never upgraded", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", pre_staff_plan: "core_supporter" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "admin", "user");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(
      /UPDATE users SET plan = \$1, pre_staff_plan = NULL/,
    );
    expect(updateParams).toEqual(["core_supporter", 5]);
  });

  it("keeps a real purchase made while staff instead of reverting past it (upgraded to elite_supporter)", async () => {
    // Granted pro_supporter, but then bought elite_supporter for real
    // (e.g. via checkout) while still staff -- plan now ranks above the
    // grant itself, not just above pre_staff_plan.
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "elite_supporter", pre_staff_plan: "free" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "admin", "user");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    // Only pre_staff_plan is cleared -- plan itself is untouched, still
    // elite_supporter.
    expect(updateSql).toMatch(
      /UPDATE users SET pre_staff_plan = NULL, updated_at = NOW\(\) WHERE id = \$1/,
    );
    expect(updateSql).not.toMatch(/SET plan = /);
    expect(updateParams).toEqual([5]);
  });

  it("still restores pre_staff_plan when current plan exactly equals the granted floor (the ordinary case)", async () => {
    // pro_supporter (the grant) ranks above pre_staff_plan="free" -- this
    // must NOT be mistaken for an upgrade past the grant itself.
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", pre_staff_plan: "free" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "support", "user");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(
      /UPDATE users SET plan = \$1, pre_staff_plan = NULL/,
    );
    expect(updateParams).toEqual(["free", 5]);
  });

  it("does nothing to plan when pre_staff_plan is NULL (was already elite_supporter when promoted)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "elite_supporter", pre_staff_plan: null }],
    });

    await syncPlanForRoleChange(5, "moderator", "user");

    // Only the SELECT ran -- no restore UPDATE, since nothing was ever granted.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the target user row does not exist", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(999, "support", "user");

    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("syncPlanForRoleChange — super_admin grants elite_supporter, not pro_supporter", () => {
  it("bumps a free-plan user straight to elite_supporter on promotion to super_admin", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", pre_staff_plan: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "user", "super_admin");

    const [, updateParams] = mockQuery.mock.calls[1];
    expect(updateParams).toEqual(["elite_supporter", "free", 5]);
  });

  it("leaves an elite_supporter user's plan untouched on promotion to super_admin", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "elite_supporter", pre_staff_plan: null }],
    });

    await syncPlanForRoleChange(5, "user", "super_admin");

    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT, no UPDATE
  });

  it("restores the original plan on demotion from super_admin back to a regular user", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "elite_supporter", pre_staff_plan: "free" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "super_admin", "user");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(
      /UPDATE users SET plan = \$1, pre_staff_plan = NULL/,
    );
    expect(updateParams).toEqual(["free", 5]);
  });

  it("compares against elite_supporter (super_admin's own grant), not pro_supporter, when deciding whether a demotion outranks the grant", async () => {
    // current plan (elite_supporter) exactly equals super_admin's granted
    // tier -- NOT above it -- so this must take the ordinary restore path.
    // Using the wrong (pro_supporter) baseline here would incorrectly
    // treat this as "a real purchase past the grant" and skip the restore.
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "elite_supporter", pre_staff_plan: "free" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "super_admin", "user");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(
      /UPDATE users SET plan = \$1, pre_staff_plan = NULL/,
    );
    expect(updateParams).toEqual(["free", 5]);
  });

  it("steps a user UP from pro_supporter to elite_supporter when admin is promoted to super_admin (staff-to-staff tier change)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "pro_supporter", pre_staff_plan: "free" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "admin", "super_admin");

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    // Re-grant path: pre_staff_plan (the true original) is left alone,
    // only plan itself steps up to the new tier.
    expect(updateSql).not.toContain("pre_staff_plan");
    expect(updateParams).toEqual(["elite_supporter", 5]);
  });

  it("steps a user DOWN from elite_supporter to pro_supporter when super_admin is demoted to admin (still staff)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "elite_supporter", pre_staff_plan: "free" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPlanForRoleChange(5, "super_admin", "admin");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).not.toContain("pre_staff_plan");
    expect(updateParams).toEqual(["pro_supporter", 5]);
  });
});

describe("syncPreStaffPlanForManualPlanChange — admin's manual update_plan action on a staff target", () => {
  it("does nothing for a non-staff target", async () => {
    await syncPreStaffPlanForManualPlanChange(5, "user", "elite_supporter");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does nothing when pre_staff_plan is NULL (nothing was ever granted)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ pre_staff_plan: null }] });

    await syncPreStaffPlanForManualPlanChange(5, "admin", "free");

    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT
  });

  it("clears pre_staff_plan when the admin bumps a staff member above the grant, instead of leaving the real original plan to be permanently discarded later", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ pre_staff_plan: "free" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPreStaffPlanForManualPlanChange(5, "admin", "elite_supporter");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE users SET pre_staff_plan = NULL/);
    expect(updateParams).toEqual([5]);
  });

  it("updates pre_staff_plan to the admin's new choice when it's at/below the grant, instead of leaving the old value to silently overwrite the correction later", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ pre_staff_plan: "core_supporter" }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPreStaffPlanForManualPlanChange(5, "moderator", "free");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE users SET pre_staff_plan = \$1/);
    expect(updateParams).toEqual(["free", 5]);
  });

  it("treats a bump to exactly pro_supporter (the grant itself) as at-or-below, not above", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ pre_staff_plan: "free" }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await syncPreStaffPlanForManualPlanChange(5, "support", "pro_supporter");

    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toMatch(/UPDATE users SET pre_staff_plan = \$1/);
    expect(updateParams).toEqual(["pro_supporter", 5]);
  });
});

describe("reconcileStaffPlans — self-heals a staff role set directly via SQL", () => {
  it("grants elite_supporter to a super_admin row that was never grant-managed", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, role: "super_admin", plan: "free" }],
    });
    // grantStaffPlan's own SELECT + UPDATE
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", pre_staff_plan: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const count = await reconcileStaffPlans();

    expect(count).toBe(1);
    const [selectSql, selectParams] = mockQuery.mock.calls[0];
    expect(selectSql).toMatch(
      /WHERE role = ANY\(\$1::text\[\]\) AND pre_staff_plan IS NULL/,
    );
    expect(selectParams).toEqual([
      [
        "admin",
        "moderator",
        "support",
        "billing",
        "security_analyst",
        "content_manager",
        "ops",
        "super_admin",
      ],
    ]);
    const [grantSql, grantParams] = mockQuery.mock.calls[2];
    expect(grantSql).toMatch(/UPDATE users SET plan = \$1, pre_staff_plan/);
    expect(grantParams).toEqual(["elite_supporter", "free", 5]);
  });

  it("skips a row whose plan is already elite_supporter or above (a real purchase, nothing to grant)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, role: "admin", plan: "elite_supporter" }],
    });

    const count = await reconcileStaffPlans();

    expect(count).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1); // only the SELECT, grantStaffPlan never called
  });

  it("reconciles multiple rows independently and returns the total count", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 5, role: "admin", plan: "free" },
        { id: 6, role: "moderator", plan: "core_supporter" },
      ],
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "free", pre_staff_plan: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ plan: "core_supporter", pre_staff_plan: null }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const count = await reconcileStaffPlans();

    expect(count).toBe(2);
  });

  it("returns 0 and issues only the SELECT when nothing needs reconciling", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const count = await reconcileStaffPlans();

    expect(count).toBe(0);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
