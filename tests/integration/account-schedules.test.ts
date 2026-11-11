import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import {
  suspendAccountSchedules,
  resumeAccountSchedules,
} from "@/lib/admin/account-schedules";
import { createUser, describeIntegration } from "./_db";

/**
 * What disabling and re-enabling an account does to its schedules, against
 * the real table.
 *
 * The claim that matters is which rows each statement touches: a schedule the
 * owner paused must still be paused after a disable and an enable, and one the
 * disable paused must be due again, on its cadence and not right away. A faked
 * pool answers both whatever the WHERE says.
 */

interface Row {
  id: number;
  active: boolean;
  next_run_at: Date | null;
}

async function addSchedule(
  userId: number,
  opts: { active: boolean; nextRunAt: Date | null },
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scheduled_scans (user_id, url, frequency, active, next_run_at)
     VALUES ($1, 'https://schedules.example.test/', 'daily', $2, $3)
     RETURNING id`,
    [userId, opts.active, opts.nextRunAt],
  );
  return rows[0].id;
}

async function read(id: number): Promise<Row> {
  const { rows } = await pool.query<Row>(
    "SELECT id, active, next_run_at FROM scheduled_scans WHERE id = $1",
    [id],
  );
  return rows[0];
}

const past = () => new Date(Date.now() - 3_600_000);

describeIntegration(
  "account disable and enable, against scheduled_scans",
  () => {
    it("pauses only the account's active schedules and leaves the owner's paused one as it was", async () => {
      const owner = await createUser();
      const other = await createUser();
      const running = await addSchedule(owner.id, {
        active: true,
        nextRunAt: past(),
      });
      const ownerPausedAt = past();
      const ownerPaused = await addSchedule(owner.id, {
        active: false,
        nextRunAt: ownerPausedAt,
      });
      const someoneElses = await addSchedule(other.id, {
        active: true,
        nextRunAt: past(),
      });

      expect(await suspendAccountSchedules(owner.id)).toBe(1);

      expect(await read(running)).toMatchObject({
        active: false,
        next_run_at: null,
      });
      const untouched = await read(ownerPaused);
      expect(untouched.active).toBe(false);
      expect(untouched.next_run_at?.getTime()).toBe(ownerPausedAt.getTime());
      expect((await read(someoneElses)).active).toBe(true);
    });

    it("resumes exactly what the disable paused, due on its cadence rather than now", async () => {
      const owner = await createUser();
      const running = await addSchedule(owner.id, {
        active: true,
        nextRunAt: past(),
      });
      const ownerPaused = await addSchedule(owner.id, {
        active: false,
        nextRunAt: past(),
      });
      await suspendAccountSchedules(owner.id);

      const before = Date.now();
      expect(await resumeAccountSchedules(owner.id)).toBe(1);

      const resumed = await read(running);
      expect(resumed.active).toBe(true);
      expect(resumed.next_run_at).not.toBeNull();
      expect(resumed.next_run_at!.getTime()).toBeGreaterThan(before);
      expect((await read(ownerPaused)).active).toBe(false);
    });

    it("resumes nothing for an account that was never disabled, and is safe to repeat", async () => {
      const owner = await createUser();
      const ownerPaused = await addSchedule(owner.id, {
        active: false,
        nextRunAt: past(),
      });
      expect(await resumeAccountSchedules(owner.id)).toBe(0);
      expect((await read(ownerPaused)).active).toBe(false);

      await addSchedule(owner.id, { active: true, nextRunAt: past() });
      expect(await suspendAccountSchedules(owner.id)).toBe(1);
      expect(await suspendAccountSchedules(owner.id)).toBe(0);
      expect(await resumeAccountSchedules(owner.id)).toBe(1);
      expect(await resumeAccountSchedules(owner.id)).toBe(0);
    });
  },
);
