import { it, expect } from "vitest";
import pool from "@/lib/database/db";
import { getAdminScanDetail } from "@/lib/admin/scan-detail";
import { describeIntegration, createUser, unique } from "./_db";

/**
 * The staff scan inspector's read, against a real scan_history row.
 *
 * The lookup matches a public_id or a numeric id in one statement, and strips
 * a running scan's partialFindings out of result_meta with the jsonb `-`
 * operator. Both are Postgres behaviour that a mocked pool answers the same
 * whether the statement is right or not.
 */
async function seedScan(
  userId: number,
  overrides: {
    status?: string;
    failureKind?: string | null;
    error?: string | null;
    resultMeta?: Record<string, unknown> | null;
  } = {},
): Promise<{ id: number; publicId: string }> {
  const { rows } = await pool.query<{ id: number; public_id: string }>(
    `INSERT INTO scan_history
       (user_id, url, status, failure_kind, error_message, result_meta,
        started_at, scanned_at, scan_type)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), 'web')
     RETURNING id, public_id`,
    [
      userId,
      `https://${unique("inspect")}.example.test/`,
      overrides.status ?? "completed",
      overrides.failureKind ?? null,
      overrides.error ?? null,
      overrides.resultMeta === undefined
        ? null
        : JSON.stringify(overrides.resultMeta),
    ],
  );
  return { id: rows[0].id, publicId: rows[0].public_id };
}

describeIntegration("the staff scan inspector's read", () => {
  it("finds one scan by public_id and by numeric id", async () => {
    const owner = await createUser();
    const scan = await seedScan(owner.id);

    const byPublic = await getAdminScanDetail(scan.publicId, {
      includeUser: true,
    });
    const byNumeric = await getAdminScanDetail(String(scan.id), {
      includeUser: true,
    });

    expect(byPublic?.id).toBe(scan.id);
    expect(byNumeric?.id).toBe(scan.id);
    expect(byPublic?.user.email).toBe(owner.email);
    expect(
      await getAdminScanDetail("0".repeat(32), { includeUser: true }),
    ).toBeNull();
  });

  it("reports why a failed scan failed, and the raw error", async () => {
    const owner = await createUser();
    const scan = await seedScan(owner.id, {
      status: "failed",
      failureKind: "target_tls",
      error: "Could not reach the target URL: certificate has expired",
    });
    const detail = await getAdminScanDetail(String(scan.id), {
      includeUser: false,
    });
    expect(detail).toMatchObject({
      status: "failed",
      failureKind: "target_tls",
      errorMessage: "Could not reach the target URL: certificate has expired",
      user: { id: owner.id, email: null, name: null },
    });
  });

  it("drops the in-flight progress list from result_meta and keeps the rest", async () => {
    const owner = await createUser();
    const scan = await seedScan(owner.id, {
      status: "running",
      resultMeta: {
        checksRun: 120,
        partialFindings: [{ severity: "high", title: "mid-scan" }],
      },
    });
    const detail = await getAdminScanDetail(String(scan.id), {
      includeUser: true,
    });
    expect(detail?.resultMeta).toEqual({ checksRun: 120 });
    expect(detail?.progress).not.toBeNull();
  });

  it("returns null result_meta for a scan that never wrote any", async () => {
    const owner = await createUser();
    const scan = await seedScan(owner.id, { status: "pending" });
    const detail = await getAdminScanDetail(String(scan.id), {
      includeUser: true,
    });
    expect(detail?.resultMeta).toBeNull();
  });
});
