import { it, expect, afterAll } from "vitest";
import pool from "@/lib/database/db";
import { aggregateCheckAccuracy } from "@/lib/scanner/check-accuracy";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The retention pass deletes confirmed verdicts at the window's age and keeps a
 * user's false positives for good. The aggregate has to read the same window,
 * or a check's false-positive rate only ever rises.
 */
const seededUsers: number[] = [];

async function verdict(
  userId: number,
  findingId: string,
  url: string,
  value: "false_positive" | "confirmed",
  ageDays: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO scan_finding_feedback
       (user_id, finding_id, finding_url, verdict, created_at)
     VALUES ($1, $2, $3, $4, NOW() - ($5 * INTERVAL '1 day'))`,
    [userId, findingId, url, value, ageDays],
  );
}

describeIntegration("check accuracy only reads the retention window", () => {
  afterAll(async () => {
    if (seededUsers.length === 0) return;
    await pool.query(
      "DELETE FROM scan_finding_feedback WHERE user_id = ANY($1::int[])",
      [seededUsers],
    );
  });

  it("leaves out a false positive older than any retention can be set to", async () => {
    const user = await createUser();
    seededUsers.push(user.id);
    const checkId = unique("accuracy-check");

    await verdict(user.id, `${checkId}--a`, "https://a.test/", "confirmed", 1);
    await verdict(
      user.id,
      `${checkId}--b`,
      "https://b.test/",
      "false_positive",
      1,
    );
    await verdict(
      user.id,
      `${checkId}--c`,
      "https://c.test/",
      "false_positive",
      4000,
    );

    const counts = (await aggregateCheckAccuracy()).get(checkId);

    expect(counts?.confirmed).toBe(1);
    expect(counts?.falsePositive).toBe(1);
  });
});
