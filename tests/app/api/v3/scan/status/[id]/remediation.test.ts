/**
 * The owner result-load path attaches remediation status. GET
 * /api/v3/scan/status/[id] for a completed scan must merge the owner's
 * current per-finding remediation status onto the returned findings, so a
 * finding marked "fixed" earlier shows as "fixed" on this freshly completed
 * scan too. Only the DB + session boundary are mocked.
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

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7 });
});

describe("GET /api/v3/scan/status/[id] remediation merge", () => {
  it("attaches the owner's remediation status to completed-scan findings", async () => {
    mockQuery
      // 1) getOwnedScan
      .mockResolvedValueOnce({
        rows: [
          {
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
            summary: {
              critical: 0,
              high: 0,
              medium: 1,
              low: 0,
              info: 0,
              total: 1,
            },
            findings: [{ id: "csp-missing--abc123", title: "Missing CSP" }],
            response_headers: null,
            result_meta: {},
            error_message: null,
          },
        ],
      })
      // 2) tags
      .mockResolvedValueOnce({ rows: [] })
      // 3) remediation (getRemediationMap: WHERE user_id=$1 AND finding_url=$2)
      .mockResolvedValueOnce({
        rows: [
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
    const remediationCall = mockQuery.mock.calls[2];
    expect(remediationCall[0]).toContain("FROM finding_remediation");
    expect(remediationCall[1]).toEqual([7, "https://example.com/"]);
  });
});
