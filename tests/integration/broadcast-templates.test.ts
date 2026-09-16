import { it, expect, beforeEach } from "vitest";
import pool from "@/lib/database/db";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The upsert behind "Save as template", against a real Postgres.
 *
 * Every claim here is about what the database does and none of it survives a
 * faked pool: a unique index on an EXPRESSION rather than a column, an
 * `ON CONFLICT` target that has to match that expression exactly or the
 * statement is a syntax error, an upsert reporting which half it did from
 * whether two NOW() defaults landed on the same timestamp, and ON DELETE SET
 * NULL. A mocked `pool.query` answers every one of those identically whether
 * it is right or wrong, which is the whole reason tests/README.md sends this
 * tier here.
 */
describeIntegration("broadcast templates", () => {
  let adminId: number;

  const save = (
    name: string,
    subject: string,
    content: string,
    description: string | null = null,
  ) =>
    pool.query<{
      id: number;
      name: string;
      subject: string;
      content: string;
      created: boolean;
    }>(
      `INSERT INTO broadcast_templates (name, description, subject, content, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (LOWER(name)) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             subject = EXCLUDED.subject,
             content = EXCLUDED.content,
             updated_at = NOW()
       RETURNING id, name, subject, content, (created_at = updated_at) AS created`,
      [name, description, subject, content, adminId],
    );

  beforeEach(async () => {
    await pool.query("DELETE FROM broadcast_templates");
    adminId = (await createUser({ role: "admin" })).id;
  });

  it("reports a first save as a creation", async () => {
    const res = await save("October promo", "Subject", "<p>Body</p>");
    expect(res.rows[0].created).toBe(true);
    expect(res.rows[0].name).toBe("October promo");
  });

  it("overwrites rather than duplicating when the name is saved again", async () => {
    const first = await save("October promo", "Old subject", "<p>Old</p>");
    const second = await save("October promo", "New subject", "<p>New</p>");

    expect(second.rows[0].created).toBe(false);
    expect(second.rows[0].id).toBe(first.rows[0].id);
    expect(second.rows[0].subject).toBe("New subject");
    expect(second.rows[0].content).toBe("<p>New</p>");

    const all = await pool.query(
      "SELECT COUNT(*)::int n FROM broadcast_templates",
    );
    expect(all.rows[0].n).toBe(1);
  });

  it("treats a name that differs only in case as the same template", async () => {
    // The point of the expression index. Without it the picker ends up
    // offering "October promo" and "October Promo", which is not a choice
    // anyone wants to be given.
    await save("October promo", "First", "<p>a</p>");
    const again = await save("OCTOBER PROMO", "Second", "<p>b</p>");

    expect(again.rows[0].created).toBe(false);
    const all = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int n FROM broadcast_templates",
    );
    expect(all.rows[0].n).toBe(1);
    // The new capitalisation wins, because the writer just typed it.
    expect(again.rows[0].name).toBe("OCTOBER PROMO");
  });

  it("keeps two genuinely different names apart", async () => {
    await save(unique("promo"), "A", "<p>a</p>");
    await save(unique("promo"), "B", "<p>b</p>");
    const all = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int n FROM broadcast_templates",
    );
    expect(all.rows[0].n).toBe(2);
  });

  it("keeps the template when the admin who wrote it is deleted", async () => {
    // ON DELETE SET NULL, not CASCADE. A template is shared staff property and
    // outlives whoever typed it; deleting a departing admin must not silently
    // take the team's announcement template with them.
    const saved = await save("Shared announcement", "Subject", "<p>Body</p>");
    await pool.query("DELETE FROM users WHERE id = $1", [adminId]);

    const after = await pool.query<{ created_by: number | null }>(
      "SELECT created_by FROM broadcast_templates WHERE id = $1",
      [saved.rows[0].id],
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].created_by).toBeNull();
  });
});
