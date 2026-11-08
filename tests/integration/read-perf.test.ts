import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import pool from "@/lib/database/db";
import { GET as trendGET } from "@/app/api/v3/host/[hostname]/trend/route";
import { GET as hostGET } from "@/app/api/v3/host/[hostname]/route";
import { GET as assetsGET } from "@/app/api/v3/assets/route";
import { GET as sharesGET } from "@/app/api/v3/shares/route";
import { GET as dashboardGET } from "@/app/api/v3/dashboard/route";
import { GET as publicScansGET } from "@/app/api/v3/public-scans/route";
import {
  describeIntegration,
  createUser,
  setSettings,
  clearSettings,
  unique,
} from "./_db";

/**
 * The read routes whose answer depends on what Postgres does with the SQL: a
 * host expression matched against stored URLs, DISTINCT ON with window totals
 * computed before a LIMIT, a CTE shared by two widgets, a tie-break. The unit
 * tests fake pool.query, so they can only say the text was sent.
 *
 * The session and the client IP are replaced because there is no request
 * scope to read them from. Everything else, the pool included, is real.
 */
const auth = vi.hoisted(() => ({ userId: 0 }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSession: async () => ({ userId: auth.userId }),
}));
vi.mock("@/lib/api/request-utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/request-utils")>()),
  getClientIp: async () => "203.0.113.77",
}));

const SQLI = { title: "SQL Injection Vulnerability", severity: "critical" };
const CSP = { title: "Missing CSP", severity: "high" };
const NOISE = {
  description: "x".repeat(200),
  explanation: "y".repeat(200),
};

interface ScanSpec {
  isPublic?: boolean;
  status?: string;
  minutesAgo?: number;
  findings?: Array<Record<string, unknown>>;
  scanType?: string;
  summary?: Record<string, number>;
}

async function insertScan(
  userId: number,
  url: string,
  spec: ScanSpec = {},
): Promise<number> {
  const findings = spec.findings ?? [];
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO scan_history
       (user_id, url, status, is_public, scan_type, summary, findings,
        findings_count, started_at, scanned_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, NOW(),
             NOW() - ($9 * INTERVAL '1 minute'))
     RETURNING id`,
    [
      userId,
      url,
      spec.status ?? "completed",
      spec.isPublic ?? true,
      spec.scanType ?? "web",
      JSON.stringify(spec.summary ?? {}),
      JSON.stringify(findings),
      findings.length,
      spec.minutesAgo ?? 0,
    ],
  );
  return rows[0].id;
}

function assetsRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v3/assets${query}`);
}

interface Asset {
  host: string;
  scanCount: number;
  latestScanId: number;
  safetyRating: string;
}

const createdUsers: number[] = [];

async function newUser(): Promise<number> {
  const user = await createUser();
  createdUsers.push(user.id);
  return user.id;
}

function site(prefix: string): string {
  return `${unique(prefix).toLowerCase()}.example.test`;
}

describeIntegration("read paths against real SQL", () => {
  beforeAll(async () => {
    await clearSettings();
    await setSettings({
      DASHBOARD_WIDGET_LIMIT: 2,
      BILLING_FREE_RETENTION: -1,
    });
  });

  afterAll(async () => {
    await clearSettings();
    await pool.query("DELETE FROM host_reputation WHERE host LIKE 'hostrep-%'");
    if (createdUsers.length > 0) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [
        createdUsers,
      ]);
    }
  });

  describe("host score trend", () => {
    async function points(host: string): Promise<number[]> {
      const res = await trendGET(
        new NextRequest(`http://localhost/api/v3/host/${host}/trend`),
        { params: Promise.resolve({ hostname: host }) },
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      return (json.points as Array<{ scanId: number }>).map((p) => p.scanId);
    }

    it("counts www and non-www, and nothing that only resembles the host", async () => {
      const host = site("trend");
      const owner = await newUser();

      const expected = [
        await insertScan(owner, `https://${host}/`, { minutesAgo: 50 }),
        await insertScan(owner, `https://www.${host}/`, { minutesAgo: 40 }),
        await insertScan(owner, `http://WWW.${host.toUpperCase()}/Path?x=1`, {
          minutesAgo: 30,
        }),
        await insertScan(owner, `https://${host}:8443/admin`, {
          minutesAgo: 20,
        }),
      ];

      await insertScan(owner, `https://evil.${host}/`);
      await insertScan(owner, `https://${host}.attacker.test/`);
      await insertScan(owner, `https://not${host}/`);
      await insertScan(owner, `https://other.example.test/?next=${host}`);
      await insertScan(owner, `https://${host}/private`, { isPublic: false });
      await insertScan(owner, `https://${host}/running`, {
        status: "running",
      });
      await insertScan(owner, `https://${host}/failed`, { status: "failed" });

      // Oldest first, the order the chart reads.
      expect(await points(host)).toEqual(expected);
      expect(await points(`www.${host}`)).toEqual(expected);
    });

    it("scores from the projected fields", async () => {
      const host = site("trend-score");
      const owner = await newUser();
      await insertScan(owner, `https://${host}/`, {
        findings: [{ ...SQLI, ...NOISE }],
      });

      const res = await trendGET(
        new NextRequest(`http://localhost/api/v3/host/${host}/trend`),
        { params: Promise.resolve({ hostname: host }) },
      );
      const json = await res.json();

      expect(json.points).toHaveLength(1);
      expect(json.points[0].dangerScore).toBeGreaterThan(0);
    });
  });

  describe("host report", () => {
    async function snapshot(
      host: string,
      findings: unknown[],
      sourceScanId: number | null,
    ): Promise<void> {
      await pool.query(
        `INSERT INTO host_reputation
           (host, danger_score, severity_counts, findings, source_scan_id,
            scanned_url, last_scanned_at)
         VALUES ($1, 5, '{}'::jsonb, $2::jsonb, $3, $4, NOW())`,
        [host, JSON.stringify(findings), sourceScanId, `https://${host}/`],
      );
    }

    async function report(host: string) {
      const res = await hostGET(
        new NextRequest(`http://localhost/api/v3/host/${host}`),
        { params: Promise.resolve({ hostname: host }) },
      );
      expect(res.status).toBe(200);
      return res.json();
    }

    it("prefers the live public scan's findings", async () => {
      const host = site("hostrep-live");
      const owner = await newUser();
      const scanId = await insertScan(owner, `https://${host}/`, {
        findings: [CSP],
      });
      await snapshot(host, [SQLI], scanId);

      const body = await report(host);

      expect(body.known).toBe(true);
      expect(body.findings).toEqual([CSP]);
    });

    it("falls back to the snapshot's findings once the source is private", async () => {
      const host = site("hostrep-private");
      const owner = await newUser();
      const scanId = await insertScan(owner, `https://${host}/`, {
        findings: [CSP],
        isPublic: false,
      });
      await snapshot(host, [SQLI], scanId);

      expect((await report(host)).findings).toEqual([SQLI]);
    });

    it("reads the snapshot when no source scan is recorded", async () => {
      const host = site("hostrep-nosource");
      await snapshot(host, [SQLI], null);

      expect((await report(host)).findings).toEqual([SQLI]);
    });
  });

  describe("assets", () => {
    async function assets(query = "") {
      const res = await assetsGET(assetsRequest(query));
      expect(res.status).toBe(200);
      return res.json();
    }

    it("groups per host in SQL, keyed to each host's newest completed scan", async () => {
      const userId = await newUser();
      const other = await newUser();
      const a = site("asset-a");
      const b = site("asset-b");

      await insertScan(userId, `https://${a}/old`, { minutesAgo: 90 });
      await insertScan(userId, `https://www.${a}/older`, { minutesAgo: 95 });
      const newestA = await insertScan(userId, `HTTPS://WWW.${a}/new`, {
        minutesAgo: 10,
        isPublic: false,
        findings: [{ ...SQLI, ...NOISE }],
      });
      await insertScan(userId, `https://${a}/queued`, {
        minutesAgo: 1,
        status: "pending",
      });
      const onlyB = await insertScan(userId, `https://${b}/`, {
        minutesAgo: 20,
      });
      const ip = await insertScan(userId, "http://203.0.113.5/admin", {
        minutesAgo: 30,
      });
      await insertScan(userId, `https://${b}/repo`, {
        minutesAgo: 2,
        scanType: "github",
      });
      await insertScan(other, `https://${a}/theirs`, { minutesAgo: 0 });

      auth.userId = userId;
      const json = await assets();

      expect(json.assets.map((x: Asset) => x.host)).toEqual([
        a,
        b,
        "203.0.113.5",
      ]);
      expect(json.assets[0]).toMatchObject({
        scanCount: 3,
        latestScanId: newestA,
        safetyRating: "unsafe",
        isPublic: false,
        findingsCount: 1,
      });
      expect(json.assets[1]).toMatchObject({
        scanCount: 1,
        latestScanId: onlyB,
        safetyRating: "safe",
      });
      expect(json.assets[2].latestScanId).toBe(ip);
      expect(json.totalHosts).toBe(3);
      expect(json.totalScans).toBe(5);
      expect(json.truncated).toBe(false);
    });

    it("keeps an IPv6 literal whole, and each address its own row", async () => {
      const userId = await newUser();
      await insertScan(userId, "https://[2001:DB8::1]:8080/x", {
        minutesAgo: 5,
      });
      const newest = await insertScan(userId, "https://[2001:db8::1]/y");
      await insertScan(userId, "https://[2001:db8::2]/", { minutesAgo: 9 });

      auth.userId = userId;
      const json = await assets();

      expect(json.assets.map((x: Asset) => x.host)).toEqual([
        "[2001:db8::1]",
        "[2001:db8::2]",
      ]);
      expect(json.assets[0]).toMatchObject({
        scanCount: 2,
        latestScanId: newest,
      });
    });

    it("lists a URL no host expression can read instead of dropping it", async () => {
      const userId = await newUser();
      const id = await insertScan(userId, "not a url at all");

      auth.userId = userId;
      const json = await assets();

      expect(json.assets).toHaveLength(1);
      expect(json.assets[0].latestScanId).toBe(id);
    });

    it("spends the cap on hosts, however many times one host was scanned", async () => {
      const userId = await newUser();
      const busy = site("asset-busy");
      const others = Array.from({ length: 11 }, (_, i) =>
        site(`asset-other${i}`),
      );

      // Ten scans of one site are newer than everything else, and ten is the
      // lowest value the setting accepts: below its floor the value is ignored
      // and the shipped default applies. Capping scan rows, as this route used
      // to, returned only this host.
      for (let i = 0; i < 10; i++) {
        await insertScan(userId, `https://${busy}/${i}`, { minutesAgo: i });
      }
      for (const [i, other] of others.entries()) {
        await insertScan(userId, `https://${other}/`, { minutesAgo: 100 + i });
      }

      auth.userId = userId;
      await setSettings({ HISTORY_LIST_MAX_ROWS: 10 });
      try {
        const capped = await assets();
        expect(capped.assets.map((x: Asset) => x.host)).toEqual([
          busy,
          ...others.slice(0, 9),
        ]);
        expect(capped.assets[0].scanCount).toBe(10);
        expect(capped).toMatchObject({
          limit: 10,
          totalHosts: 12,
          totalScans: 21,
          truncated: true,
        });

        await setSettings({ HISTORY_LIST_MAX_ROWS: 12 });
        const exact = await assets();
        expect(exact.assets).toHaveLength(12);
        expect(exact.truncated).toBe(false);
      } finally {
        await clearSettings();
        await setSettings({
          DASHBOARD_WIDGET_LIMIT: 2,
          BILLING_FREE_RETENTION: -1,
        });
      }
    });

    it("counts only scans inside the plan's retention window", async () => {
      const userId = await newUser();
      const host = site("asset-retention");
      const gone = site("asset-retention-gone");
      await insertScan(userId, `https://${host}/recent`, { minutesAgo: 60 });
      await insertScan(userId, `https://${host}/expired`, {
        minutesAgo: 60 * 24 * 10,
      });
      await insertScan(userId, `https://${gone}/expired`, {
        minutesAgo: 60 * 24 * 10,
      });

      auth.userId = userId;
      await setSettings({ BILLING_FREE_RETENTION: 7 });
      try {
        const json = await assets();
        expect(json.assets.map((x: Asset) => x.host)).toEqual([host]);
        expect(json.assets[0].scanCount).toBe(1);
        expect(json.totalScans).toBe(1);
      } finally {
        await setSettings({ BILLING_FREE_RETENTION: -1 });
      }
    });

    it("rates scope=all from the projected fields", async () => {
      const host = site("hostrep-all");
      await pool.query(
        `INSERT INTO host_reputation
           (host, danger_score, severity_counts, findings, scanned_url,
            last_scanned_at)
         VALUES ($1, 9, '{"critical":1}'::jsonb, $2::jsonb, $3, NOW())`,
        [host, JSON.stringify([{ ...SQLI, ...NOISE }]), `https://${host}/`],
      );
      auth.userId = await newUser();

      const json = await assets("?scope=all");
      const row = json.assets.find((x: Asset) => x.host === host);

      expect(row).toMatchObject({ safetyRating: "unsafe", findingsCount: 1 });
    });
  });

  describe("shares", () => {
    async function shares() {
      const res = await sharesGET(
        new NextRequest("http://localhost/api/v3/shares"),
      );
      expect(res.status).toBe(200);
      return res.json();
    }

    it("caps the list, says so only when something was left out, and keeps the rating fields", async () => {
      const userId = await newUser();
      const salt = randomBytes(6).toString("hex");
      await pool.query(
        `INSERT INTO scan_history
           (user_id, url, status, started_at, scanned_at, scan_type, summary,
            findings, findings_count, duration, share_token)
         SELECT $1::int, 'https://share-' || n || '.example.test/', 'completed',
                NOW(), NOW() - (n * INTERVAL '1 second'), 'web', '{}'::jsonb,
                $2::jsonb, 1, 1, $3::text || '-' || n
           FROM generate_series(1, 501) AS n`,
        [userId, JSON.stringify([{ ...SQLI, ...NOISE }]), salt],
      );
      await insertScan(userId, "https://unshared.example.test/");

      auth.userId = userId;
      const over = await shares();

      expect(over.shares).toHaveLength(500);
      expect(over.limit).toBe(500);
      expect(over.truncated).toBe(true);
      // Newest first, and the row past the cap is the oldest.
      expect(over.shares[0].url).toBe("https://share-1.example.test/");
      expect(over.shares[499].url).toBe("https://share-500.example.test/");
      expect(over.shares[0].findings).toEqual([
        { ...SQLI, aiVerdict: null, aiConfidence: null },
      ]);

      await pool.query(
        "DELETE FROM scan_history WHERE user_id = $1 AND share_token = $2",
        [userId, `${salt}-501`],
      );
      const exact = await shares();

      expect(exact.shares).toHaveLength(500);
      expect(exact.truncated).toBe(false);
    });
  });

  describe("dashboard", () => {
    it("answers zeros and an empty list for an account with no completed scan", async () => {
      auth.userId = await newUser();

      const json = await (await dashboardGET()).json();

      expect(json.severityBreakdown).toEqual({
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      });
      expect(json.topVulnerabilities).toEqual([]);
      expect(json.totalScans).toBe(0);
    });

    it("keeps the widget limit and the ranking on the shared posture read", async () => {
      const userId = await newUser();
      const a = `https://${site("dash-a")}/`;
      const b = `https://${site("dash-b")}/`;
      await insertScan(userId, a, {
        summary: { critical: 1, high: 1 },
        findings: [SQLI, CSP, { title: "Rare", severity: "low" }],
      });
      await insertScan(userId, b, {
        summary: { high: 1 },
        findings: [CSP],
      });
      // An older scan of the same target must not be counted in either widget.
      await insertScan(userId, a, {
        minutesAgo: 500,
        summary: { critical: 9 },
        findings: [SQLI, SQLI, SQLI],
      });

      auth.userId = userId;
      const json = await (await dashboardGET()).json();

      expect(json.severityBreakdown.critical).toBe(1);
      expect(json.severityBreakdown.high).toBe(2);
      expect(json.topVulnerabilities).toHaveLength(2);
      expect(json.topVulnerabilities[0]).toEqual({
        title: "Missing CSP",
        severity: "high",
        count: 2,
      });
    });

    it("refuses a suspended account from the merged read", async () => {
      const userId = await newUser();
      await insertScan(userId, `https://${site("dash-off")}/`);
      await pool.query("UPDATE users SET disabled_at = NOW() WHERE id = $1", [
        userId,
      ]);

      auth.userId = userId;
      const res = await dashboardGET();

      expect(res.status).toBe(403);
      expect((await res.json()).totalScans).toBeUndefined();
    });
  });

  describe("public scans", () => {
    it("breaks a timestamp tie by id, newest first", async () => {
      const userId = await newUser();
      const stamp = "2099-01-01T00:00:00.000Z";
      const tokens: string[] = [];
      for (let i = 0; i < 3; i++) {
        const token = randomBytes(16).toString("hex");
        tokens.push(token);
        await pool.query(
          `INSERT INTO scan_history
             (user_id, url, status, started_at, scanned_at, scan_type, summary,
              findings, findings_count, duration, share_token,
              share_publicly_listed)
           VALUES ($1, $2, 'completed', NOW(), $3, 'web', '{}'::jsonb,
                   '[]'::jsonb, 0, 1, $4, true)`,
          [userId, `https://tie-${token}.example.test/`, stamp, token],
        );
      }

      const res = await publicScansGET(
        new NextRequest("http://localhost/api/v3/public-scans?limit=100"),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      const listed = (json.scans as Array<{ token: string }>)
        .map((s) => s.token)
        .filter((t) => tokens.includes(t));

      expect(listed).toEqual([...tokens].reverse());
    });
  });
});
