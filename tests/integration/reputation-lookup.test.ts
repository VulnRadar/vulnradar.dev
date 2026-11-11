import { afterAll, expect, it } from "vitest";
import pool from "@/lib/database/db";
import { getExactUrlReputation } from "@/lib/scanner/host-reputation";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The exact-page half of GET /api/v3/scan/reputation, against Postgres.
 *
 * The unit suite can only check the SQL text it sends; whether that text
 * finds the right row is a question for the server. The 0.2.3 extension asks
 * about a page by origin and path and never sends the query string, so a scan
 * stored with one has to be found, a trailing slash on either side must not
 * turn a match into a miss, and nothing private, unfinished or merely similar
 * may be returned. The answer must not carry the stored query string either:
 * matching ignores it, so it can be someone else's token.
 */
const seeded: number[] = [];

async function seedScan(
  url: string,
  options: {
    isPublic?: boolean;
    status?: string;
    scannedAt?: string;
    findings?: unknown[];
  } = {},
): Promise<{ id: number; publicId: string }> {
  const owner = await createUser();
  const { rows } = await pool.query<{ id: number; public_id: string }>(
    `INSERT INTO scan_history (user_id, url, status, started_at, scanned_at, scan_type, is_public, findings)
     VALUES ($1, $2, $3, NOW(), $4, 'web', $5, $6)
     RETURNING id, public_id`,
    [
      owner.id,
      url,
      options.status ?? "completed",
      options.scannedAt ?? new Date().toISOString(),
      options.isPublic ?? true,
      JSON.stringify(options.findings ?? []),
    ],
  );
  seeded.push(rows[0].id);
  return { id: rows[0].id, publicId: rows[0].public_id };
}

function site(prefix: string): string {
  return `${unique(prefix).replace(/[^a-z0-9]/g, "")}.example.test`;
}

describeIntegration("exact-page reputation lookup", () => {
  afterAll(async () => {
    if (seeded.length > 0) {
      await pool.query("DELETE FROM scan_history WHERE id = ANY($1::int[])", [
        seeded,
      ]);
    }
  });

  it("finds a scan stored with a query string when asked by origin and path", async () => {
    const host = site("query");
    const scan = await seedScan(
      `https://${host}/reset?token=secret-reset-token`,
    );

    const result = await getExactUrlReputation(`https://${host}/reset`);

    expect(result?.scanId).toBe(scan.id);
    expect(result?.scanPublicId).toBe(scan.publicId);
    expect(result?.url).toBe(`https://${host}/reset`);
    expect(JSON.stringify(result)).not.toContain("secret-reset-token");
  });

  it("matches across a trailing slash in either direction", async () => {
    const withSlash = site("slash");
    const stored = await seedScan(`https://${withSlash}/docs/`);
    expect(
      (await getExactUrlReputation(`https://${withSlash}/docs`))?.scanId,
    ).toBe(stored.id);

    const withoutSlash = site("noslash");
    const bare = await seedScan(`https://${withoutSlash}/docs`);
    expect(
      (await getExactUrlReputation(`https://${withoutSlash}/docs/`))?.scanId,
    ).toBe(bare.id);

    const root = site("root");
    const rootScan = await seedScan(`https://${root}`);
    expect((await getExactUrlReputation(`https://${root}/`))?.scanId).toBe(
      rootScan.id,
    );
  });

  it("drops the fragment and a caller's own query before comparing", async () => {
    const host = site("frag");
    const scan = await seedScan(`https://${host}/page`);
    expect(
      (await getExactUrlReputation(`https://${host}/page?ref=mail#section`))
        ?.scanId,
    ).toBe(scan.id);
  });

  it("returns the newest public, completed scan of the page", async () => {
    const host = site("newest");
    await seedScan(`https://${host}/a?v=1`, {
      scannedAt: "2026-01-01T00:00:00Z",
    });
    const newest = await seedScan(`https://${host}/a/`, {
      scannedAt: "2026-03-01T00:00:00Z",
    });
    await seedScan(`https://${host}/a`, {
      scannedAt: "2026-04-01T00:00:00Z",
      isPublic: false,
    });
    await seedScan(`https://${host}/a`, {
      scannedAt: "2026-05-01T00:00:00Z",
      status: "running",
    });

    const result = await getExactUrlReputation(`https://${host}/a`);

    expect(result?.scanId).toBe(newest.id);
    expect(result?.lastScannedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("does not answer for a neighbouring page, a longer path or a private scan alone", async () => {
    const host = site("miss");
    await seedScan(`https://${host}/page-two`);
    await seedScan(`https://${host}/page/child`);
    await seedScan(`https://${host}/pagex?x=1`);
    await seedScan(`https://${host}/page`, { isPublic: false });

    expect(await getExactUrlReputation(`https://${host}/page`)).toBeNull();
  });

  it("rates the page from the four projected finding fields as it would from the full findings", async () => {
    const host = site("rating");
    await seedScan(`https://${host}/`, {
      findings: [
        {
          id: "sqli",
          title: "SQL Injection",
          severity: "critical",
          description: "x".repeat(5000),
          fix: "Use parameterised queries.",
          aiVerdict: "confirmed",
          aiConfidence: 0.9,
        },
        { id: "hsts", title: "Missing HSTS", severity: "high" },
        { id: "info", title: "Server banner", severity: "info" },
      ],
    });

    const result = await getExactUrlReputation(`https://${host}/`);

    expect(result?.severityCounts).toEqual({
      critical: 1,
      high: 1,
      medium: 0,
      low: 0,
      info: 1,
    });
    expect(result?.verdict).toBe("unsafe");
    expect(result?.dangerScore).toBeGreaterThan(0);
  });
});
