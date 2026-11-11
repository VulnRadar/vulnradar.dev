import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { applyBootSchema } from "@/lib/database/boot/apply-boot-schema";
import { deleteUserAccountData } from "@/lib/auth/account-deletion";
import { fetchUserDetailBundle } from "@/lib/admin/user-detail";
import { describeIntegration, createUser } from "./_db";

/**
 * Deleting a staff account must not take what it did for other people with
 * it (bug-db-1).
 *
 * admin_user_notes.admin_id and gifted_subscriptions.gifted_by were NOT NULL
 * with ON DELETE CASCADE, so erasing a staff member deleted every note they
 * had written about other accounts and every plan they had gifted, and the
 * people they gifted to dropped to their own plan with nothing to say why.
 * Whether the rows survive is the foreign key's ON DELETE rule, which only a
 * real database applies.
 *
 * The second test rebuilds the old constraints first, which is what every
 * database created before this change has, so it also proves the boot step
 * that converts them.
 */

async function seed() {
  const admin = await createUser({ role: "admin" });
  const member = await createUser();
  const note = await pool.query<{ id: number }>(
    `INSERT INTO admin_user_notes (user_id, admin_id, note)
     VALUES ($1, $2, 'Asked for a refund on the 3rd') RETURNING id`,
    [member.id, admin.id],
  );
  const gift = await pool.query<{ id: number }>(
    `INSERT INTO gifted_subscriptions (user_id, gifted_by, plan, expires_at)
     VALUES ($1, $2, 'pro_supporter', NOW() + INTERVAL '30 days') RETURNING id`,
    [member.id, admin.id],
  );
  return {
    admin,
    member,
    noteId: note.rows[0].id,
    giftId: gift.rows[0].id,
  };
}

async function deleteAccount(userId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await deleteUserAccountData(client, userId);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function expectSurvived(noteId: number, giftId: number) {
  const note = await pool.query<{ admin_id: number | null; note: string }>(
    "SELECT admin_id, note FROM admin_user_notes WHERE id = $1",
    [noteId],
  );
  expect(note.rows).toEqual([
    { admin_id: null, note: "Asked for a refund on the 3rd" },
  ]);

  const gift = await pool.query<{
    gifted_by: number | null;
    live: boolean;
  }>(
    `SELECT gifted_by, (revoked_at IS NULL AND expires_at > NOW()) AS live
       FROM gifted_subscriptions WHERE id = $1`,
    [giftId],
  );
  expect(gift.rows).toEqual([{ gifted_by: null, live: true }]);
}

describeIntegration("deleting a staff account", () => {
  it("keeps the notes it wrote and the gifts it gave", async () => {
    const { admin, member, noteId, giftId } = await seed();
    await deleteAccount(admin.id);
    await expectSurvived(noteId, giftId);

    // And the admin view of the account still lists it, by a former staff
    // member, rather than dropping it on an inner join to the deleted author.
    const bundle = await fetchUserDetailBundle(member.id, {
      scans: false,
      apiKeys: false,
      webhooks: false,
      sessions: false,
      credits: false,
    });
    expect(bundle?.notes).toEqual([
      expect.objectContaining({
        id: noteId,
        admin_id: null,
        admin_name: "Former staff member",
      }),
    ]);
    await pool.query("DELETE FROM users WHERE id = $1", [member.id]);
  });

  it("is fixed by the boot on a database that still has the old cascades", async () => {
    await pool.query(`
      DELETE FROM admin_user_notes WHERE admin_id IS NULL;
      DELETE FROM gifted_subscriptions WHERE gifted_by IS NULL;
      ALTER TABLE admin_user_notes
        DROP CONSTRAINT admin_user_notes_admin_id_fkey,
        ADD CONSTRAINT admin_user_notes_admin_id_fkey
          FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
        ALTER COLUMN admin_id SET NOT NULL;
      ALTER TABLE gifted_subscriptions
        DROP CONSTRAINT gifted_subscriptions_gifted_by_fkey,
        ADD CONSTRAINT gifted_subscriptions_gifted_by_fkey
          FOREIGN KEY (gifted_by) REFERENCES users(id) ON DELETE CASCADE,
        ALTER COLUMN gifted_by SET NOT NULL;
    `);

    await applyBootSchema(pool, "Test");

    const { admin, member, noteId, giftId } = await seed();
    await pool.query("DELETE FROM users WHERE id = $1", [admin.id]);
    await expectSurvived(noteId, giftId);
    await pool.query("DELETE FROM users WHERE id = $1", [member.id]);
  });
});
