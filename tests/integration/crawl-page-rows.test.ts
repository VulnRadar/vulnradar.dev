import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { insertCrawlPageRows } from "@/lib/scanner/crawl-page-rows";
import type {
  CrawlPageRow,
  CrawlPageRowOwner,
} from "@/lib/scanner/crawl-page-rows";
import { finalizeScanFailure } from "@/lib/scanner/scan-jobs";
import { describeIntegration, createUser, createTeam } from "./_db";

/**
 * The page rows a crawl saves beside its tracker row.
 *
 * The statement is an INSERT ... SELECT from a VALUES list with an EXISTS on
 * the tracker's status, and both halves are things a faked pool cannot check:
 * that every parameter resolves to its column's type once it has been through
 * a VALUES list (an untyped one comes out as text and is refused by the
 * integer, jsonb and timestamptz columns), and that a tracker which already
 * went terminal inserts nothing. That second property is the whole point: the
 * rows used to be written unconditionally, so a crawl cancelled during its
 * enrichment passes left up to 250 pages in History as completed scans.
 */

const BASE = "https://crawl.example.test";

function pageRow(path: string, overrides: Partial<CrawlPageRow> = {}) {
  return {
    url: `${BASE}${path}`,
    summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0, total: 1 },
    findings: [
      {
        id: `missing-hsts--${path}`,
        title: "Missing Strict-Transport-Security header",
        severity: "medium",
      },
    ],
    findingsCount: 1,
    duration: 812,
    responseHeaders: { server: "nginx" },
    resultMeta: { dangerScore: 2, siteGrade: "B", engineConfidence: 90 },
    ...overrides,
  } satisfies CrawlPageRow;
}

function owner(
  userId: number,
  overrides: Partial<CrawlPageRowOwner> = {},
): CrawlPageRowOwner {
  return {
    userId,
    scannedAt: new Date().toISOString(),
    source: "web",
    notes: "Full scan",
    isPublic: false,
    authenticated: false,
    teamId: null,
    ...overrides,
  };
}

async function insertTracker(
  userId: number,
  status: "pending" | "running" = "running",
): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history
       (user_id, url, source, notes, status, started_at, categories_total, is_public)
     VALUES ($1, $2, 'web', 'Full scan', $3, NOW(), 0, true)
     RETURNING id`,
    [userId, `${BASE}/`, status],
  );
  return rows[0].id;
}

/** Every scan_history row the user has other than the tracker itself. */
async function pageRowsOf(userId: number, trackerId: number) {
  const { rows } = await pool.query<{
    id: number;
    url: string;
    status: string;
    source: string;
    user_id: number;
    team_id: number | null;
    is_public: boolean;
    authenticated: boolean;
    notes: string | null;
    findings_count: number;
    duration: number;
    scanned_at: Date;
    summary: Record<string, number>;
    findings: Array<{ id: string }>;
    response_headers: Record<string, string>;
    result_meta: Record<string, unknown>;
  }>(`SELECT * FROM scan_history WHERE user_id = $1 AND id <> $2 ORDER BY id`, [
    userId,
    trackerId,
  ]);
  return rows;
}

describeIntegration("crawl page rows", () => {
  it("saves the pages of a running crawl as completed rows and returns their ids by url", async () => {
    const user = await createUser();
    const trackerId = await insertTracker(user.id);
    const rows = [pageRow("/"), pageRow("/about")];

    const ids = await insertCrawlPageRows(trackerId, owner(user.id), rows);

    expect(Object.keys(ids).sort()).toEqual(rows.map((r) => r.url).sort());
    const saved = await pageRowsOf(user.id, trackerId);
    expect(saved).toHaveLength(2);
    for (const row of saved) {
      expect(ids[row.url]).toBe(row.id);
      // The INSERT names no status, so the column default applies.
      expect(row.status).toBe("completed");
      expect(row.user_id).toBe(user.id);
      expect(row.source).toBe("web");
      expect(row.notes).toBe("Full scan");
      // The crawl's privacy reaches every page: is_public defaults to TRUE,
      // so a row that lost it would publish a private crawl.
      expect(row.is_public).toBe(false);
      expect(row.authenticated).toBe(false);
      expect(row.team_id).toBeNull();
      expect(row.findings_count).toBe(1);
      expect(row.duration).toBe(812);
      expect(row.scanned_at).toBeInstanceOf(Date);
      expect(row.summary.total).toBe(1);
      expect(row.findings).toHaveLength(1);
      expect(row.response_headers).toEqual({ server: "nginx" });
      expect(row.result_meta).toMatchObject({ siteGrade: "B" });
    }
  });

  it("carries the tracker's team and the authenticated flag onto every page", async () => {
    const user = await createUser();
    const teamId = await createTeam(user.id);
    const trackerId = await insertTracker(user.id, "pending");

    await insertCrawlPageRows(
      trackerId,
      owner(user.id, { teamId, authenticated: true, source: "web" }),
      [pageRow("/a"), pageRow("/b")],
    );

    const saved = await pageRowsOf(user.id, trackerId);
    expect(saved.map((r) => r.team_id)).toEqual([teamId, teamId]);
    expect(saved.map((r) => r.authenticated)).toEqual([true, true]);
  });

  it("round-trips text that JSON and SQL both have opinions about", async () => {
    const user = await createUser();
    const trackerId = await insertTracker(user.id);
    const url = `${BASE}/search?q=%22quoted%22&x=it's&u=%E2%9C%93`;

    const ids = await insertCrawlPageRows(trackerId, owner(user.id), [
      pageRow("/", {
        url,
        findings: [{ id: "a", title: 'He said "hi" \\ and ✓', note: "'" }],
      }),
    ]);

    const [row] = await pageRowsOf(user.id, trackerId);
    expect(ids[url]).toBe(row.id);
    expect(row.url).toBe(url);
    expect(row.findings[0]).toMatchObject({
      title: 'He said "hi" \\ and ✓',
      note: "'",
    });
  });

  it("writes a full-size crawl in one statement", async () => {
    // 250 pages is the largest plan's selection cap: 3,500 parameters.
    const user = await createUser();
    const trackerId = await insertTracker(user.id);
    const rows = Array.from({ length: 250 }, (_unused, i) => pageRow(`/p${i}`));

    const ids = await insertCrawlPageRows(trackerId, owner(user.id), rows);

    expect(Object.keys(ids)).toHaveLength(250);
    expect(await pageRowsOf(user.id, trackerId)).toHaveLength(250);
  });

  it("inserts nothing for a crawl that was cancelled before the rows were written", async () => {
    const user = await createUser();
    const trackerId = await insertTracker(user.id);
    await finalizeScanFailure(trackerId, "Cancelled", "cancelled");

    const ids = await insertCrawlPageRows(trackerId, owner(user.id), [
      pageRow("/"),
      pageRow("/about"),
    ]);

    expect(ids).toEqual({});
    expect(await pageRowsOf(user.id, trackerId)).toEqual([]);
  });

  it("inserts nothing for a crawl the watchdog already failed", async () => {
    const user = await createUser();
    const trackerId = await insertTracker(user.id);
    await finalizeScanFailure(
      trackerId,
      "Crawl scan exceeded the 900s time limit.",
      "timeout",
    );

    const ids = await insertCrawlPageRows(trackerId, owner(user.id), [
      pageRow("/"),
    ]);

    expect(ids).toEqual({});
    expect(await pageRowsOf(user.id, trackerId)).toEqual([]);
  });

  it("inserts nothing for a tracker that already completed or does not exist", async () => {
    const user = await createUser();
    const trackerId = await insertTracker(user.id);
    await pool.query(
      `UPDATE scan_history SET status = 'completed' WHERE id = $1`,
      [trackerId],
    );

    expect(
      await insertCrawlPageRows(trackerId, owner(user.id), [pageRow("/")]),
    ).toEqual({});
    expect(
      await insertCrawlPageRows(2_147_483_000, owner(user.id), [pageRow("/")]),
    ).toEqual({});
    expect(await pageRowsOf(user.id, trackerId)).toEqual([]);
  });

  it("does nothing, and sends no statement, for a crawl with no readable pages", async () => {
    const user = await createUser();
    const trackerId = await insertTracker(user.id);

    expect(await insertCrawlPageRows(trackerId, owner(user.id), [])).toEqual(
      {},
    );
    expect(await pageRowsOf(user.id, trackerId)).toEqual([]);
  });
});
