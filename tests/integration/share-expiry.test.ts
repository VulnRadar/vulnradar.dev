import { it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { GET } from "@/app/api/v3/shared/[token]/route";
import { describeIntegration, createUser } from "./_db";

/**
 * Share-link expiry, judged by Postgres rather than asserted as a string.
 *
 * The unit test for this route mocks `pool.query` and checks that the SQL
 * TEXT contains "AND (sh.share_expires_at IS NULL OR sh.share_expires_at >
 * NOW())". That proves the sentence is present. It cannot prove the
 * comparison runs the right way round, because a faked pool answers a query
 * with a flipped operator exactly as it answers a correct one -- and a
 * flipped operator here means every expired share link in the product stays
 * readable by anyone holding the URL, forever, while the suite stays green.
 *
 * The route is public, so nothing here needs a session.
 */
async function shareScan(
  userId: number,
  expiresAt: string | null,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  // share_token_hash is GENERATED ALWAYS from share_token, so the row is
  // written the way the share route writes it and Postgres derives the hash
  // the lookup matches on.
  await pool.query(
    `INSERT INTO scan_history
       (user_id, url, status, started_at, scanned_at, scan_type, summary,
        findings, findings_count, duration, share_token, share_expires_at)
     VALUES ($1, $2, 'completed', NOW(), NOW(), 'web',
             '{"critical":0,"high":0,"medium":0,"low":0,"info":0,"total":0}'::jsonb,
             '[]'::jsonb, 0, 1, $3, $4)`,
    [
      userId,
      `https://share-${token.slice(0, 8)}.example.test/`,
      token,
      expiresAt,
    ],
  );
  return token;
}

async function fetchShare(token: string) {
  return GET(new NextRequest(`http://localhost/api/v3/shared/${token}`), {
    params: Promise.resolve({ token }),
  });
}

describeIntegration("share link expiry, against a real clock", () => {
  it("serves a link that has not expired", async () => {
    const user = await createUser();
    const token = await shareScan(user.id, null);
    const res = await fetchShare(token);
    expect(res.status).toBe(200);

    const future = await shareScan(
      user.id,
      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    );
    expect((await fetchShare(future)).status).toBe(200);
  });

  it("refuses a link whose expiry has passed, the same as a revoked one", async () => {
    const user = await createUser();
    const expired = await shareScan(
      user.id,
      new Date(Date.now() - 60 * 1000).toISOString(),
    );
    const res = await fetchShare(expired);
    expect(res.status).toBe(404);

    // Nothing from the scan leaks in the refusal body.
    const body = await res.text();
    expect(body).not.toContain("example.test");
  });

  it("refuses a token that was never issued", async () => {
    const res = await fetchShare(randomBytes(32).toString("hex"));
    expect(res.status).toBe(404);
  });
});
