import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import pool from "@/lib/database/db";
import { scanUrlLookupForms } from "@/lib/scanner/scan-identity";
import { clearSettings, createUser, describeIntegration, unique } from "./_db";

/**
 * The scan entry routes against the real schema. Three of the properties here
 * are answers only Postgres can give: that two spellings of one site land in
 * scan_history as one string, that a refused capped charge (an ON CONFLICT
 * whose DO UPDATE is skipped by its WHERE) leaves the reserved row closed as
 * refused rather than pending, and that the single remediation upsert keeps
 * the columns a body leaves out (a CASE inside DO UPDATE). A faked pool
 * answers every one of those the same whether the SQL is right or not.
 *
 * Only what is not the database is replaced: the session, the resolver-backed
 * SSRF guard (no DNS in CI), and the detached executor, which would otherwise
 * go on to fetch the target.
 */
let sessionUserId: number | null = null;
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () =>
      sessionUserId === null ? null : { userId: sessionUserId },
  };
});

vi.mock("@/lib/scanner/safe-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/safe-fetch")>();
  return {
    ...actual,
    validateScanTarget: async () => ({
      safe: true,
      resolvedIp: "93.184.216.34",
    }),
  };
});

const executeScan = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/scanner/execute-scan", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/scanner/execute-scan")>();
  return {
    ...actual,
    executeScan: (...args: unknown[]) => executeScan(...args),
  };
});

// The read-only gate is answered here so the request reaches the capped
// charge with the counter already at the cap: the race the charge exists to
// close, where two requests both passed the gate and only one may run. The
// charge itself is the real statement.
let gateLimit: number | null = null;
vi.mock("@/lib/rate-limiting/daily-limits", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/daily-limits")>();
  return {
    ...actual,
    canMakeRequest: async (userId: number) =>
      gateLimit === null
        ? actual.canMakeRequest(userId)
        : {
            allowed: true,
            limit: gateLimit,
            used: gateLimit - 1,
            remaining: 1,
            resetsAt: new Date(Date.now() + 3600_000).toISOString(),
          },
  };
});

const { POST: createScan } = await import("@/app/api/v3/scan/route");
const { POST: setRemediation } =
  await import("@/app/api/v3/scan/remediation/route");

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A host under its own root domain, so no other suite's target limit counts. */
function freshHost(): string {
  return `${unique("entry").replace(/[^a-z0-9]/g, "")}.test`;
}

async function storedUrls(userId: number): Promise<string[]> {
  const { rows } = await pool.query<{ url: string }>(
    "SELECT url FROM scan_history WHERE user_id = $1 ORDER BY id",
    [userId],
  );
  return rows.map((row) => row.url);
}

describeIntegration("scan entry routes", () => {
  afterEach(async () => {
    sessionUserId = null;
    gateLimit = null;
    executeScan.mockClear();
    await clearSettings();
  });

  it("stores 'host' and 'https://host/' as the same scan_history.url", async () => {
    const user = await createUser();
    sessionUserId = user.id;
    const host = freshHost();

    const bare = await createScan(
      post("/api/v3/scan", { url: host, isPublic: false }),
    );
    // The executor is faked, so the first scan never leaves 'pending' and
    // holds the account's one concurrent slot. Finish it the way a run would.
    await pool.query(
      "UPDATE scan_history SET status = 'completed' WHERE user_id = $1",
      [user.id],
    );
    const full = await createScan(
      post("/api/v3/scan", { url: `https://${host}/`, isPublic: false }),
    );

    expect(bare.status).toBe(200);
    expect(full.status).toBe(200);
    expect(await storedUrls(user.id)).toEqual([
      `https://${host}/`,
      `https://${host}/`,
    ]);
  });

  it("closes the reserved row as refused, and never runs it, when the capped charge finds the cap reached", async () => {
    const user = await createUser();
    sessionUserId = user.id;
    gateLimit = 2;
    await pool.query(
      `INSERT INTO rate_limits (key, "count", window_start)
       VALUES ($1, 2, date_trunc('day', NOW()))`,
      [`daily_scan:${user.id}`],
    );

    const res = await createScan(
      post("/api/v3/scan", { url: freshHost(), isPublic: false }),
    );

    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe("DAILY_LIMIT");
    expect(executeScan).not.toHaveBeenCalled();
    const { rows } = await pool.query<{
      status: string;
      failure_kind: string | null;
    }>("SELECT status, failure_kind FROM scan_history WHERE user_id = $1", [
      user.id,
    ]);
    expect(rows).toEqual([{ status: "failed", failure_kind: "quota_refused" }]);
    const counter = await pool.query<{ count: number }>(
      `SELECT "count" FROM rate_limits
        WHERE key = $1 AND window_start = date_trunc('day', NOW())`,
      [`daily_scan:${user.id}`],
    );
    expect(Number(counter.rows[0].count)).toBe(2);
  });

  it("finds a row stored before the root slash rule by the canonical url's lookup forms", async () => {
    const user = await createUser();
    const host = freshHost();
    await pool.query(
      `INSERT INTO scan_history (user_id, url, status)
       VALUES ($1, $2, 'completed'), ($1, $3, 'completed')`,
      [user.id, `https://${host}`, `https://${host}/`],
    );

    const { rows } = await pool.query<{ url: string }>(
      `SELECT url FROM scan_history
        WHERE user_id = $1 AND url = ANY($2::text[])
        ORDER BY id`,
      [user.id, scanUrlLookupForms(host)],
    );

    expect(rows.map((row) => row.url)).toEqual([
      `https://${host}`,
      `https://${host}/`,
    ]);
  });

  it("keeps the note, assignee and due date when a remediation update sends only a status", async () => {
    const user = await createUser();
    sessionUserId = user.id;
    const finding = {
      findingId: "csp-missing--abc123",
      findingUrl: `https://${freshHost()}/`,
    };

    const first = await setRemediation(
      post("/api/v3/scan/remediation", {
        ...finding,
        status: "in_progress",
        note: "Ticket VR-118",
        assignee: "sam",
        dueAt: "2027-01-15",
      }),
    );
    expect(first.status).toBe(200);

    const second = await setRemediation(
      post("/api/v3/scan/remediation", { ...finding, status: "fixed" }),
    );
    expect(second.status).toBe(200);

    const { rows } = await pool.query<{
      status: string;
      note: string | null;
      assignee: string | null;
      due_kept: boolean | null;
    }>(
      `SELECT status, note, assignee, due_at = '2027-01-15'::timestamptz AS due_kept
         FROM finding_remediation
        WHERE user_id = $1 AND finding_id = $2 AND finding_url = $3`,
      [user.id, finding.findingId, finding.findingUrl],
    );
    expect(rows).toEqual([
      {
        status: "fixed",
        note: "Ticket VR-118",
        assignee: "sam",
        due_kept: true,
      },
    ]);

    const cleared = await setRemediation(
      post("/api/v3/scan/remediation", {
        ...finding,
        status: "fixed",
        note: null,
        assignee: null,
      }),
    );
    expect(cleared.status).toBe(200);
    const after = await pool.query<{
      note: string | null;
      assignee: string | null;
      due_kept: boolean | null;
    }>(
      `SELECT note, assignee, due_at = '2027-01-15'::timestamptz AS due_kept
         FROM finding_remediation
        WHERE user_id = $1 AND finding_id = $2 AND finding_url = $3`,
      [user.id, finding.findingId, finding.findingUrl],
    );
    expect(after.rows).toEqual([
      { note: null, assignee: null, due_kept: true },
    ]);
  });
});
