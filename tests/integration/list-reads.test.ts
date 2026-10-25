import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import pool from "@/lib/database/db";
import { GET as dashboardGET } from "@/app/api/v3/dashboard/route";
import { GET as assetsGET } from "@/app/api/v3/assets/route";
import { GET as badgeScansGET } from "@/app/api/v3/badge/scans/route";
import { GET as historyGET } from "@/app/api/v3/history/route";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
} from "./_db";

/**
 * The read paths behind the dashboard, Assets, the badge builder and History,
 * run as the real route handlers against a real PostgreSQL.
 *
 * Why this tier and not the route unit tests: those fake `pool.query`, so they
 * can show the route sends `status = 'completed'` and nothing more. Whether
 * `DISTINCT ON (url) ... ORDER BY url, scanned_at DESC` then picks the right
 * row, and whether the `incomplete` CASE runs on every shape result_meta takes,
 * are properties of the database (tests/README.md, "Two tiers, two rules").
 *
 * The thing under test is one rule: a scan row exists as 'pending' with summary
 * '{}' and no findings from the moment it is queued, and a failed one keeps
 * those defaults. None of them is a result, so none may be a target's "latest
 * scan". Before the status filter, a rescan that was still running (or had
 * died) replaced the last real result with zeros, and the dashboard dropped the
 * criticals, Assets rated the host "safe" and the badge builder called it
 * "Clean", exactly when scans were failing.
 *
 * Only getSession is replaced, and only because there is no cookie to read in
 * a test. Everything else, the pool included, is real.
 */
const auth = vi.hoisted(() => ({ userId: 0 }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: async () => ({ userId: auth.userId }) };
});

type Status = "pending" | "running" | "completed" | "failed";

interface ScanSpec {
  status: Status;
  /** Larger is older, so the ordering never depends on insert order. */
  minutesAgo: number;
  summary?: Record<string, number>;
  findings?: Array<{ title: string; severity: string }>;
  errorMessage?: string;
  /** undefined and null both store SQL NULL. */
  resultMeta?: unknown;
}

const SQLI = { title: "SQL Injection Vulnerability", severity: "critical" };
const XSS = { title: "Reflected XSS", severity: "critical" };
const CSP = { title: "Missing CSP", severity: "high" };

async function insertScan(
  userId: number,
  url: string,
  spec: ScanSpec,
): Promise<number> {
  const findings = spec.findings ?? [];
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history
       (user_id, url, status, summary, findings, findings_count,
        error_message, result_meta, started_at, scanned_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb,
             NOW(), NOW() - ($9 * INTERVAL '1 minute'))
     RETURNING id`,
    [
      userId,
      url,
      spec.status,
      JSON.stringify(spec.summary ?? {}),
      JSON.stringify(findings),
      findings.length,
      spec.errorMessage ?? null,
      spec.resultMeta === undefined || spec.resultMeta === null
        ? null
        : JSON.stringify(spec.resultMeta),
      spec.minutesAgo,
    ],
  );
  return rows[0].id;
}

const createdUsers: number[] = [];

async function newUser(): Promise<number> {
  const user = await createUser();
  createdUsers.push(user.id);
  return user.id;
}

describeIntegration("list read paths", () => {
  beforeAll(async () => {
    // Wide enough that no fixture is cut off by the widget cap, and the free
    // plan's retention at its shipped "unlimited" so the first assets call
    // takes the unlimited branch. The dated branch is exercised explicitly
    // below. These hooks live inside the gated describe on purpose: a hook at
    // the top of the file would run, and try to reach a database, in a run
    // that has none.
    await clearSettings();
    await setSettings({ DASHBOARD_WIDGET_LIMIT: 20 });
  });

  afterAll(async () => {
    await clearSettings();
    // Cascades to scan_history, so a later suite that counts rows it did not
    // create does not see these.
    if (createdUsers.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [
        createdUsers,
      ]);
    }
  });

  describe("a newer pending or failed scan does not replace the latest completed one", () => {
    const A = "https://latest-a.example.test/";
    const B = "https://latest-b.example.test/";
    const ONLY_FAILED = "https://latest-never-finished.example.test/";
    const CLEAN = "https://latest-clean.example.test/";

    let userId: number;
    let completedA: number;
    let completedB: number;
    let completedClean: number;

    beforeAll(async () => {
      userId = await newUser();

      // A: two criticals and a high on its last real scan, then three newer rows
      // that carry no result at all.
      completedA = await insertScan(userId, A, {
        status: "completed",
        minutesAgo: 120,
        summary: { critical: 2, high: 1, medium: 0, low: 0, info: 0, total: 3 },
        findings: [SQLI, XSS, CSP],
      });
      await insertScan(userId, A, { status: "pending", minutesAgo: 30 });
      await insertScan(userId, A, {
        status: "failed",
        minutesAgo: 20,
        errorMessage: "connect ECONNREFUSED 10.0.0.5:5432",
      });
      await insertScan(userId, A, { status: "running", minutesAgo: 5 });

      // B: one high, then a failed rescan.
      completedB = await insertScan(userId, B, {
        status: "completed",
        minutesAgo: 90,
        summary: { high: 1, total: 1 },
        findings: [CSP],
      });
      await insertScan(userId, B, {
        status: "failed",
        minutesAgo: 10,
        errorMessage: "Cancelled",
      });

      // A target whose every attempt failed or is still running: no posture.
      await insertScan(userId, ONLY_FAILED, {
        status: "failed",
        minutesAgo: 60,
        errorMessage:
          "Scan interrupted by a server restart. Please run it again.",
      });
      await insertScan(userId, ONLY_FAILED, {
        status: "pending",
        minutesAgo: 2,
      });

      // A genuinely clean site whose rescan then failed: still clean, and still
      // present, because its last real result IS clean.
      completedClean = await insertScan(userId, CLEAN, {
        status: "completed",
        minutesAgo: 200,
        summary: { total: 0 },
      });
      await insertScan(userId, CLEAN, { status: "failed", minutesAgo: 15 });
    });

    it("dashboard: posture and top findings come from each target's latest completed scan", async () => {
      auth.userId = userId;
      const json = await (await dashboardGET()).json();

      // A contributes 2 critical + 1 high, B 1 high. Taken from the newest row of
      // any status these were all zero: the pending, failed and running rows
      // have summary '{}'.
      expect(json.severityBreakdown).toEqual({
        critical: 2,
        high: 2,
        medium: 0,
        low: 0,
        info: 0,
      });

      const top = Object.fromEntries(
        (
          json.topVulnerabilities as Array<{ title: string; count: number }>
        ).map((t) => [t.title, t.count]),
      );
      // Missing CSP is on both A and B: ranked across the sites, once each.
      expect(top["Missing CSP"]).toBe(2);
      expect(top["SQL Injection Vulnerability"]).toBe(1);
      expect(top["Reflected XSS"]).toBe(1);
    });

    it("dashboard: Recent scans still lists every attempt, with the failure reason made safe", async () => {
      auth.userId = userId;
      const json = await (await dashboardGET()).json();
      const recent = json.recentScans as Array<{
        url: string;
        status: string;
        error_message?: string | null;
      }>;

      // The posture numbers ignore non-completed rows; the activity list is the
      // one place they belong.
      expect(
        recent
          .filter((s) => s.url === A)
          .map((s) => s.status)
          .sort(),
      ).toEqual(["completed", "failed", "pending", "running"]);
      const failed = recent.find((s) => s.url === A && s.status === "failed")!;
      expect(failed.error_message).toBeTruthy();
      expect(failed.error_message).not.toContain("10.0.0.5");
      // Left exactly as stored, because the History row keys on it.
      const cancelled = recent.find(
        (s) => s.url === B && s.status === "failed",
      )!;
      expect(cancelled.error_message).toBe("Cancelled");
    });

    it("assets (unlimited retention): the host reports its completed scan, not the newer empty row", async () => {
      auth.userId = userId;
      await setSettings({ BILLING_FREE_RETENTION: -1 });
      const json = await (
        await assetsGET(new NextRequest("http://localhost/api/v3/assets"))
      ).json();

      const byHost = Object.fromEntries(
        (
          json.assets as Array<{
            host: string;
            latestScanId: number;
            findingsCount: number;
            safetyRating: string;
            scanCount: number;
          }>
        ).map((a) => [a.host, a]),
      );

      // The bug: latestScanId was the running row, findingsCount 0, rating
      // "safe".
      expect(byHost["latest-a.example.test"]).toMatchObject({
        latestScanId: completedA,
        findingsCount: 3,
        safetyRating: "unsafe",
        scanCount: 1,
      });
      expect(byHost["latest-b.example.test"]).toMatchObject({
        latestScanId: completedB,
        findingsCount: 1,
      });
      expect(byHost["latest-clean.example.test"]).toMatchObject({
        latestScanId: completedClean,
        findingsCount: 0,
        safetyRating: "safe",
      });
      // No completed scan, no posture to show, and certainly not "safe".
      expect(byHost["latest-never-finished.example.test"]).toBeUndefined();
    });

    it("assets (dated retention window): same answer through the other query", async () => {
      auth.userId = userId;
      // The route has two SELECTs, one per retention shape. Without this the
      // dated one could lose its filter and the unlimited one would still pass.
      await setSettings({ BILLING_FREE_RETENTION: 30 });
      try {
        const json = await (
          await assetsGET(new NextRequest("http://localhost/api/v3/assets"))
        ).json();
        const hosts = (json.assets as Array<{ host: string }>).map(
          (a) => a.host,
        );

        expect(hosts).toContain("latest-a.example.test");
        expect(hosts).not.toContain("latest-never-finished.example.test");
        const a = (
          json.assets as Array<{
            host: string;
            latestScanId: number;
            findingsCount: number;
          }>
        ).find((x) => x.host === "latest-a.example.test")!;
        expect(a.latestScanId).toBe(completedA);
        expect(a.findingsCount).toBe(3);
      } finally {
        await setSettings({ BILLING_FREE_RETENTION: -1 });
      }
    });

    it("badge builder: each URL lists its latest completed scan and its findings", async () => {
      auth.userId = userId;
      const json = await (await badgeScansGET()).json();
      const scans = json.scans as Array<{
        id: number;
        url: string;
        findings: unknown[];
        findings_count: number;
      }>;
      const byUrl = Object.fromEntries(scans.map((s) => [s.url, s]));

      // The bug: id was the running row and findings [], which the builder rates
      // "Clean".
      expect(byUrl[A].id).toBe(completedA);
      expect(byUrl[A].findings).toHaveLength(3);
      expect(byUrl[A].findings_count).toBe(3);
      expect(byUrl[B].id).toBe(completedB);
      expect(byUrl[CLEAN].id).toBe(completedClean);
      // One row per URL, and none for a URL that never produced a result.
      expect(scans.filter((s) => s.url === A)).toHaveLength(1);
      expect(byUrl[ONLY_FAILED]).toBeUndefined();
    });

    it("another account's scans never leak into these answers", async () => {
      const other = await newUser();
      await insertScan(other, A, {
        status: "completed",
        minutesAgo: 1,
        summary: { critical: 9, total: 9 },
        findings: [SQLI],
      });

      auth.userId = userId;
      const dash = await (await dashboardGET()).json();
      expect(dash.severityBreakdown.critical).toBe(2);

      const badge = await (await badgeScansGET()).json();
      const a = (badge.scans as Array<{ url: string; id: number }>).find(
        (s) => s.url === A,
      )!;
      expect(a.id).toBe(completedA);
    });
  });

  describe("History list: incomplete flag and error text, on real rows", () => {
    let userId: number;
    const ids: Record<string, string> = {};

    async function publicIdOf(scanId: number): Promise<string> {
      const { rows } = await pool.query<{ public_id: string }>(
        "SELECT public_id FROM scan_history WHERE id = $1",
        [scanId],
      );
      return rows[0].public_id;
    }

    beforeAll(async () => {
      userId = await newUser();
      const rows: Array<[string, ScanSpec]> = [
        // Finished, nothing found, but an area never ran.
        [
          "partial",
          {
            status: "completed",
            minutesAgo: 10,
            resultMeta: { incomplete: ["tls", "dns"] },
          },
        ],
        // Finished and genuinely nothing.
        ["clean", { status: "completed", minutesAgo: 11, resultMeta: {} }],
        // Rows from before result_meta existed.
        ["legacy", { status: "completed", minutesAgo: 12, resultMeta: null }],
        // The key present but empty, and present but not an array: neither may
        // count, and neither may make the query raise.
        [
          "empty-array",
          {
            status: "completed",
            minutesAgo: 13,
            resultMeta: { incomplete: [] },
          },
        ],
        [
          "scalar",
          {
            status: "completed",
            minutesAgo: 14,
            resultMeta: { incomplete: "tls" },
          },
        ],
        [
          "internal-error",
          {
            status: "failed",
            minutesAgo: 15,
            errorMessage:
              'relation "scan_history_x" does not exist (10.0.0.5:5432)',
          },
        ],
        [
          "cancelled",
          { status: "failed", minutesAgo: 16, errorMessage: "Cancelled" },
        ],
      ];
      for (const [name, spec] of rows) {
        const id = await insertScan(
          userId,
          `https://history-${name}.example.test/`,
          spec,
        );
        ids[name] = await publicIdOf(id);
      }
    });

    async function listed() {
      auth.userId = userId;
      const res = await historyGET(
        new NextRequest("http://localhost/api/v3/history"),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      return Object.fromEntries(
        (
          json.scans as Array<{
            id: string;
            incomplete: boolean;
            error_message?: string | null;
          }>
        ).map((s) => [s.id, s]),
      );
    }

    it("flags only a non-empty incomplete array, whatever shape result_meta has", async () => {
      const byId = await listed();
      expect(byId[ids["partial"]].incomplete).toBe(true);
      expect(byId[ids["clean"]].incomplete).toBe(false);
      expect(byId[ids["legacy"]].incomplete).toBe(false);
      expect(byId[ids["empty-array"]].incomplete).toBe(false);
      expect(byId[ids["scalar"]].incomplete).toBe(false);
    });

    it("returns a failure as a sentence, never the stored driver string", async () => {
      const byId = await listed();
      const msg = byId[ids["internal-error"]].error_message!;
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("scan_history_x");
      expect(msg).not.toContain("10.0.0.5");
      expect(byId[ids["cancelled"]].error_message).toBe("Cancelled");
      // A completed scan has no error text and must not be given one.
      expect(byId[ids["clean"]].error_message).toBeNull();
    });
  });
});
