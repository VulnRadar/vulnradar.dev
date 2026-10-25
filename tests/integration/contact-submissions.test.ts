import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  countContactSubmissions,
  listContactSubmissions,
  recordContactSubmission,
  recordContactEmailOutcome,
} from "@/lib/support/contact-submissions";
import { deleteUserAccountData } from "@/lib/auth/account-deletion";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * Contact submissions against the real schema, because every claim worth
 * making here is a claim about the table.
 *
 * The unit tier fakes pool.query, so it answers an INSERT naming a column
 * that does not exist exactly as it answers a correct one, and it cannot say
 * anything about the CHECK constraints, the defaults, or whether the purge in
 * account-deletion.ts actually matches these rows.
 */
describeIntegration("contact submissions", () => {
  it("stores a submission and reports the send outcome back onto it", async () => {
    const email = unique("visitor") + "@example.test";
    const id = await recordContactSubmission({
      source: "landing",
      name: email,
      email,
      subject: null,
      category: "landing",
      message: "Do you support self-hosted Postgres?",
      ipAddress: "203.0.113.7",
    });

    const fresh = await pool.query<{
      email_status: string;
      email_error: string | null;
      handled_at: string | null;
    }>(
      "SELECT email_status, email_error, handled_at FROM contact_submissions WHERE id = $1",
      [id],
    );
    // Pending until the send settles, so a row still pending long after its
    // created_at means the process died mid-send.
    expect(fresh.rows[0].email_status).toBe("pending");
    expect(fresh.rows[0].email_error).toBeNull();
    expect(fresh.rows[0].handled_at).toBeNull();

    await recordContactEmailOutcome(id, {
      delivered: false,
      error: "smtp: 535 auth failed",
    });

    const after = await pool.query<{
      email_status: string;
      email_error: string | null;
    }>(
      "SELECT email_status, email_error FROM contact_submissions WHERE id = $1",
      [id],
    );
    expect(after.rows[0].email_status).toBe("failed");
    expect(after.rows[0].email_error).toBe("smtp: 535 auth failed");

    await pool.query("DELETE FROM contact_submissions WHERE id = $1", [id]);
  });

  it("refuses a source or status the code does not use", async () => {
    // The CHECK constraints are the only thing stopping a typo'd source from
    // becoming a category of submission nobody's query ever finds.
    await expect(
      pool.query(
        `INSERT INTO contact_submissions (source, name, email, category, message)
         VALUES ('pigeon', 'a', 'a@example.test', 'other', 'm')`,
      ),
    ).rejects.toThrow();

    await expect(
      pool.query(
        `INSERT INTO contact_submissions (name, email, category, message, email_status)
         VALUES ('a', 'a@example.test', 'other', 'm', 'maybe')`,
      ),
    ).rejects.toThrow();
  });

  it("erasing an account removes what that address sent us", async () => {
    // Nothing links these rows to an account by a foreign key: the landing
    // form takes messages from people who have no account at all, so the
    // address is the only handle. That means only the explicit purge in
    // account-deletion.ts reaches them, the same shape email_logs needs.
    const user = await createUser();

    await recordContactSubmission({
      source: "contact",
      name: "Alex",
      email: user.email,
      subject: "Found a bug",
      category: "bug",
      message: "the token in this URL is hunter2",
      ipAddress: null,
    });

    const bystanderEmail = unique("bystander") + "@example.test";
    const bystanderId = await recordContactSubmission({
      source: "contact",
      name: "Sam",
      email: bystanderEmail,
      subject: "Unrelated",
      category: "other",
      message: "keep me",
      ipAddress: null,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await deleteUserAccountData(client, user.id);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const mine = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM contact_submissions WHERE email = $1",
      [user.email],
    );
    expect(mine.rows[0].n).toBe(0);

    // And nobody else's.
    const theirs = await pool.query(
      "SELECT 1 FROM contact_submissions WHERE id = $1",
      [bystanderId],
    );
    expect(theirs.rowCount).toBe(1);

    await pool.query("DELETE FROM contact_submissions WHERE id = $1", [
      bystanderId,
    ]);
  });

  it("erasing an account removes staff invites addressed to it", async () => {
    // invited_by cascades, so an invite the account SENT goes with it. One
    // sent TO it did not, because the recipient is an address and not a
    // foreign key, and an unaccepted invite is a live grant of that role to
    // whoever holds the link.
    const inviter = await createUser({ role: "admin" });
    const invitee = await createUser();

    await pool.query(
      `INSERT INTO staff_invites (token, email, role, invited_by, expires_at)
       VALUES ($1, $2, 'support', $3, NOW() + INTERVAL '7 days')`,
      [unique("tok"), invitee.email, inviter.id],
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await deleteUserAccountData(client, invitee.id);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const left = await pool.query<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM staff_invites WHERE LOWER(email) = $1",
      [invitee.email.toLowerCase()],
    );
    expect(left.rows[0].n).toBe(0);
  });

  it("lists submissions newest first, finds the ones whose email failed, and pages by id", async () => {
    // The staff email is a pointer now, so this list is where a message is
    // read, and `failed` is how a pointer a mail filter ate gets found.
    const tag = unique("inbox");
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(
        await recordContactSubmission({
          source: "contact",
          name: tag,
          email: `${tag}-${i}@example.test`,
          subject: `${tag} ${i}`,
          category: "bug",
          message: `message ${i}`,
          ipAddress: "203.0.113.7",
        }),
      );
    }
    await recordContactEmailOutcome(ids[1], {
      delivered: false,
      error: "550 5.7.0 Blocked by SpamAssassin",
    });
    await recordContactEmailOutcome(ids[2], { delivered: true });

    const failed = await listContactSubmissions({ status: "failed" });
    const ours = failed.submissions.filter((s) => s.name === tag);
    expect(ours.map((s) => s.id)).toEqual([ids[1]]);
    expect(ours[0].email_error).toContain("SpamAssassin");
    // The IP is kept for abuse handling and never reaches a staff screen.
    expect(ours[0]).not.toHaveProperty("ip_address");

    // Page through everything ours, two at a time, by following nextBefore.
    // Other suites share this table, so keep only our rows when comparing.
    const seen: number[] = [];
    let before: number | null = null;
    for (let guard = 0; guard < 500; guard++) {
      const page = await listContactSubmissions({
        before,
        limit: 2,
      });
      seen.push(
        ...page.submissions.filter((s) => s.name === tag).map((s) => s.id),
      );
      if (page.nextBefore === null) break;
      before = page.nextBefore;
    }
    expect(seen).toEqual([...ids].reverse());

    const counts = await countContactSubmissions();
    expect(counts.failed).toBeGreaterThanOrEqual(1);
    expect(counts.sent).toBeGreaterThanOrEqual(1);
    expect(counts.pending).toBeGreaterThanOrEqual(2);

    await pool.query("DELETE FROM contact_submissions WHERE name = $1", [tag]);
  });
});
