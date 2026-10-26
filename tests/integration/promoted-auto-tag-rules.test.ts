import { it, expect, beforeEach, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { loadAiTagCandidates } from "@/lib/tags/ai-tag-candidates";
import {
  deletePromotedRule,
  listPromotedRules,
} from "@/lib/tags/promoted-rules";
import { describeIntegration, createUser } from "./_db";
import {
  addAiTaggedScan,
  cleanupTracked,
  clearAiTags,
  insertPromotedRule,
  trackedTag,
} from "./_auto-tag-fixtures";

/**
 * Listing and removing promoted auto-tag rules against a real PostgreSQL.
 *
 * A faked pool cannot say whether a DELETE ... RETURNING removed the row it
 * named, whether the LEFT JOIN to users keeps a rule whose promoter has been
 * deleted (promoted_auto_tag_rules.created_by is ON DELETE SET NULL), or that
 * taking a rule out hands its tag back to the candidate list.
 */
describeIntegration("promoted auto-tag rules", () => {
  beforeEach(clearAiTags);
  afterAll(cleanupTracked);

  it("lists the rules newest first with their promoter, and survives that account being deleted", async () => {
    const admin = await createUser({ role: "admin" });
    await pool.query("UPDATE users SET name = 'Sam Admin' WHERE id = $1", [
      admin.id,
    ]);
    const older = trackedTag("older-rule");
    const newer = trackedTag("newer-rule");
    await insertPromotedRule(older, { createdBy: admin.id, ageDays: 5 });
    await insertPromotedRule(newer, { createdBy: admin.id, ageDays: 1 });

    const mine = (await listPromotedRules()).filter((r) =>
      [older, newer].includes(r.tag),
    );

    expect(mine.map((r) => r.tag)).toEqual([newer, older]);
    expect(mine[0]).toMatchObject({
      cwes: ["CWE-350"],
      categories: [],
      requireBoth: false,
      minSeverity: "high",
      minCount: 2,
      createdBy: "Sam Admin",
    });
    expect(Number.isNaN(Date.parse(mine[0].createdAt))).toBe(false);

    // The rule outlives whoever promoted it.
    await pool.query("DELETE FROM users WHERE id = $1", [admin.id]);
    const orphaned = (await listPromotedRules()).find((r) => r.tag === newer);
    expect(orphaned).toBeDefined();
    expect(orphaned!.createdBy).toBeNull();
  });

  it("shows a masked address for a promoter who never set a name", async () => {
    const user = await createUser({ role: "admin" });
    const tag = trackedTag("nameless-promoter");
    await insertPromotedRule(tag, { createdBy: user.id });

    const rule = (await listPromotedRules()).find((r) => r.tag === tag);

    expect(rule!.createdBy).not.toBe(user.email);
    expect(rule!.createdBy).toContain("@example.test");
    expect(rule!.createdBy).toContain("*");
  });

  it("removes exactly the rule it was given, once", async () => {
    const keep = trackedTag("keep-rule");
    const drop = trackedTag("drop-rule");
    await insertPromotedRule(keep);
    const dropId = await insertPromotedRule(drop);

    const first = await deletePromotedRule(dropId);
    const second = await deletePromotedRule(dropId);

    expect(first).toEqual({
      tag: drop,
      cwes: ["CWE-350"],
      categories: [],
      minSeverity: "high",
      minCount: 2,
    });
    // Gone already: a second admin removing the same rule is told so, not
    // handed a success for work they did not do.
    expect(second).toBeNull();
    const tags = (await listPromotedRules()).map((r) => r.tag);
    expect(tags).toContain(keep);
    expect(tags).not.toContain(drop);
  });

  it("returns null for an id that was never a rule", async () => {
    await expect(deletePromotedRule(2_000_000_000)).resolves.toBeNull();
  });

  it("hands the tag back to the candidate list when its rule is removed, so it can be redone", async () => {
    const tag = trackedTag("redo");
    const user = await createUser();
    for (let i = 0; i < 3; i++) await addAiTaggedScan(user.id, [tag]);
    const ruleId = await insertPromotedRule(tag);

    expect((await loadAiTagCandidates()).map((c) => c.tag)).not.toContain(tag);

    await deletePromotedRule(ruleId);

    expect((await loadAiTagCandidates()).map((c) => c.tag)).toContain(tag);
  });
});
