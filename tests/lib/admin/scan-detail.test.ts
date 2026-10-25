import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { getAdminScanDetail, SCAN_DETAIL_FINDINGS_CAP } =
  await import("@/lib/admin/scan-detail");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    public_id: "a".repeat(32),
    user_id: 9,
    url: "https://target.example.test/",
    status: "completed",
    failure_kind: null,
    error_message: null,
    source: "web",
    scan_type: "web",
    started_at: "2026-10-01T10:00:00.000Z",
    scanned_at: "2026-10-01T10:00:04.000Z",
    duration: 3800,
    findings_count: 2,
    summary: { critical: 0, high: 1, medium: 1, low: 0, info: 0 },
    current_category: null,
    categories_completed: 12,
    categories_total: 12,
    authenticated: false,
    is_public: true,
    findings: [
      {
        id: "missing-csp",
        title: "No CSP",
        severity: "high",
        category: "headers",
        confidence: 90,
        cwe: "CWE-693",
        evidence: "x".repeat(900),
        explanation: "never returned",
      },
      { id: "cookie-flags", title: "Cookie flags", severity: "medium" },
    ],
    result_meta: { checksRun: 310 },
    user_email: "owner@example.test",
    user_name: "Owner",
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getAdminScanDetail", () => {
  it("finds a scan by public_id or by numeric id, in one query", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] });
    await getAdminScanDetail("a".repeat(32), { includeUser: true });
    expect(mockQuery.mock.calls[0][1]).toEqual(["a".repeat(32), null]);

    mockQuery.mockResolvedValueOnce({ rows: [row()] });
    await getAdminScanDetail("41", { includeUser: true });
    expect(mockQuery.mock.calls[1][1]).toEqual(["41", 41]);
  });

  it("does not query for an id that cannot be either shape", async () => {
    expect(
      await getAdminScanDetail("not a scan id!", { includeUser: true }),
    ).toBeNull();
    expect(
      await getAdminScanDetail("x".repeat(65), { includeUser: true }),
    ).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns null when nothing matches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(
      await getAdminScanDetail("b".repeat(32), { includeUser: true }),
    ).toBeNull();
  });

  it("strips the running scan's partial findings from result_meta in SQL", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] });
    await getAdminScanDetail("41", { includeUser: true });
    expect(String(mockQuery.mock.calls[0][0])).toContain(
      "(sh.result_meta - 'partialFindings') AS result_meta",
    );
  });

  it("shapes the row, trimming evidence to an excerpt", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] });
    const scan = await getAdminScanDetail("41", { includeUser: true });
    expect(scan).toMatchObject({
      id: 41,
      status: "completed",
      failureKind: null,
      durationMs: 3800,
      findingsCount: 2,
      progress: null,
      findingsTruncated: false,
      user: { id: 9, email: "owner@example.test", name: "Owner" },
    });
    const first = scan?.findings[0];
    expect(first?.id).toBe("missing-csp");
    expect(first?.evidence?.length).toBeLessThan(400);
    expect(first?.evidence?.endsWith("...")).toBe(true);
    // A finding the engine wrote with fewer fields still lists.
    expect(scan?.findings[1]).toMatchObject({
      title: "Cookie flags",
      confidence: null,
      evidence: null,
    });
    // Only the compact fields leave the server.
    expect(first).not.toHaveProperty("explanation");
  });

  it("caps the findings and says so", async () => {
    const many = Array.from(
      { length: SCAN_DETAIL_FINDINGS_CAP + 25 },
      (_, i) => ({
        id: `f-${i}`,
        title: `Finding ${i}`,
        severity: "low",
      }),
    );
    mockQuery.mockResolvedValueOnce({
      rows: [row({ findings: many, findings_count: many.length })],
    });
    const scan = await getAdminScanDetail("41", { includeUser: true });
    expect(scan?.findings).toHaveLength(SCAN_DETAIL_FINDINGS_CAP);
    expect(scan?.findingsTruncated).toBe(true);
    expect(scan?.findingsCount).toBe(many.length);
  });

  it("gives the owner as a bare id when the caller may not see accounts", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] });
    const scan = await getAdminScanDetail("41", { includeUser: false });
    expect(scan?.user).toEqual({ id: 9, email: null, name: null });
  });

  it("reports progress only for a scan still in flight", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        row({
          status: "running",
          current_category: "headers",
          categories_completed: 3,
          categories_total: 12,
          findings: [],
          findings_count: 0,
        }),
      ],
    });
    const scan = await getAdminScanDetail("41", { includeUser: true });
    expect(scan?.progress).toEqual({
      currentCategory: "headers",
      completed: 3,
      total: 12,
    });
  });

  it("carries the failure kind and the raw error", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        row({
          status: "failed",
          failure_kind: "target_tls",
          error_message: "Could not reach the target URL: certificate expired",
          findings: [],
          findings_count: 0,
          result_meta: null,
        }),
      ],
    });
    const scan = await getAdminScanDetail("41", { includeUser: true });
    expect(scan?.failureKind).toBe("target_tls");
    expect(scan?.errorMessage).toContain("certificate expired");
    expect(scan?.resultMeta).toBeNull();
  });
});
