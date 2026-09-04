/**
 * The owner result-load path attaches triage. GET /api/v3/scan/status/[id]
 * for a completed scan must merge the owner's current per-finding remediation
 * status AND their false-positive verdicts onto the returned findings, so a
 * finding marked "fixed" or dismissed on an earlier scan of the same target
 * carries that straight onto this freshly completed one.
 *
 * The false-positive half is the newer of the two: this route attached
 * remediation and app/api/v3/history/[id] attached both, so a finding the
 * owner had already dismissed came back unflagged on a fresh scan and only
 * picked up its badge once the page was reloaded out of History.
 *
 * Only the DB + session boundary are mocked. Queries are routed by SQL shape
 * rather than call order, so adding a lookup to the route does not shift a
 * positional index out from under an unrelated assertion.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

const { GET } = await import("@/app/api/v3/scan/status/[id]/route");

function getRequest(): NextRequest {
  return new NextRequest("http://localhost/api/v3/scan/status/123", {
    method: "GET",
  });
}

const SCAN_ROW = {
  id: 123,
  public_id: "pub123",
  user_id: 7,
  url: "https://example.com/",
  status: "completed",
  current_category: null,
  categories_completed: 10,
  categories_total: 10,
  started_at: "2026-01-01",
  duration: 2500,
  scanned_at: "2026-01-01",
  summary: { critical: 0, high: 0, medium: 1, low: 0, info: 0, total: 1 },
  findings: [
    { id: "csp-missing--abc123", title: "Missing CSP" },
    { id: "bogus--abc123", title: "Not real here" },
  ],
  response_headers: null,
  result_meta: {},
  error_message: null,
};

function installQueryMock({
  remediationRows = [] as Record<string, unknown>[],
  falsePositiveIds = [] as string[],
} = {}) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM scan_history")) return { rows: [SCAN_ROW] };
    if (sql.includes("FROM scan_tags")) return { rows: [] };
    if (sql.includes("FROM finding_remediation")) {
      return { rows: remediationRows };
    }
    if (sql.includes("FROM scan_finding_feedback")) {
      return { rows: falsePositiveIds.map((finding_id) => ({ finding_id })) };
    }
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
});

describe("GET /api/v3/scan/status/[id] triage merge", () => {
  it("attaches the owner's remediation status to completed-scan findings", async () => {
    installQueryMock({
      remediationRows: [
        {
          finding_id: "csp-missing--abc123",
          status: "fixed",
          note: "patched",
          assignee: null,
        },
      ],
    });

    const res = await GET(getRequest(), {
      params: Promise.resolve({ id: "123" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.findings[0].remediation).toEqual({
      status: "fixed",
      note: "patched",
      assignee: null,
    });

    // The remediation read must be scoped by the owner + the scanned URL,
    // never the scan id -- that is what makes it survive rescans.
    const call = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("FROM finding_remediation"),
    );
    expect(call).toBeDefined();
    expect(call![1]).toEqual([7, "https://example.com/"]);
  });

  it("flags a finding the owner already dismissed, without waiting for a History reload", async () => {
    installQueryMock({ falsePositiveIds: ["bogus--abc123"] });

    const json = await (
      await GET(getRequest(), { params: Promise.resolve({ id: "123" }) })
    ).json();

    const byId = Object.fromEntries(
      json.result.findings.map((f: { id: string; suppressed?: boolean }) => [
        f.id,
        f.suppressed,
      ]),
    );
    expect(byId["bogus--abc123"]).toBe(true);
    expect(byId["csp-missing--abc123"]).toBeUndefined();
  });

  it("leaves every finding unflagged when the owner has dismissed nothing", async () => {
    installQueryMock();

    const json = await (
      await GET(getRequest(), { params: Promise.resolve({ id: "123" }) })
    ).json();

    for (const f of json.result.findings as { suppressed?: boolean }[]) {
      expect(f.suppressed).toBeUndefined();
    }
  });
});
