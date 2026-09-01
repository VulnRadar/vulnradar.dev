/**
 * Route-level tests for POST /api/v3/scan/remediation/bulk. DB mocked at the
 * pool boundary; getSession mocked. Focuses on the semantics that matter:
 * status always applies, assignee/dueAt only when present, note never touched,
 * status 'open' clears each row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const calls: { sql: string; params: unknown[] }[] = [];
const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  calls.push({ sql, params });
  return { rows: [] };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params ?? []),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getSession: () => mockGetSession() }));

const { POST } = await import("@/app/api/v3/scan/remediation/bulk/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/scan/remediation/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ITEMS = [
  { findingId: "csp-missing--a", findingUrl: "https://example.com/" },
  { findingId: "hsts-missing--b", findingUrl: "https://example.com/" },
];

beforeEach(() => {
  mockQuery.mockClear();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  calls.length = 0;
});

describe("POST /api/v3/scan/remediation/bulk", () => {
  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postRequest({ items: ITEMS, status: "fixed" }));
    expect(res.status).toBe(401);
  });

  it("rejects an empty item list", async () => {
    const res = await POST(postRequest({ items: [], status: "fixed" }));
    expect(res.status).toBe(400);
  });

  it("upserts every item in ONE statement, preserving assignee/due when they aren't sent", async () => {
    const res = await POST(postRequest({ items: ITEMS, status: "fixed" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(2);
    // One statement, not one per item: a single INSERT ... SELECT over
    // unnest() is atomic, so a partial failure can no longer leave half the
    // selection changed while the UI says nothing was applied.
    expect(calls).toHaveLength(1);

    expect(calls[0].sql).toContain("INSERT INTO finding_remediation");
    expect(calls[0].sql).toContain("unnest($2::text[], $3::text[])");
    // status set; assignee/due NOT touched (booleans false); note never in SET.
    expect(calls[0].params).toEqual([
      42,
      ["csp-missing--a", "hsts-missing--b"],
      ["https://example.com/", "https://example.com/"],
      "fixed",
      null, // assignee value
      null, // due value
      false, // setAssignee
      false, // setDue
    ]);
    expect(calls[0].sql).not.toMatch(/SET[\s\S]*note/);
  });

  it("applies assignee and a parsed due date when sent", async () => {
    await POST(
      postRequest({
        items: [ITEMS[0]],
        status: "in_progress",
        assignee: "Alice",
        dueAt: "2026-09-01",
      }),
    );
    expect(calls[0].params).toEqual([
      42,
      ["csp-missing--a"],
      ["https://example.com/"],
      "in_progress",
      "Alice",
      "2026-09-01",
      true,
      true,
    ]);
  });

  it("clears the selection with one DELETE when status is 'open'", async () => {
    await POST(postRequest({ items: ITEMS, status: "open" }));
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("DELETE FROM finding_remediation");
    expect(calls[0].sql).toContain("unnest($2::text[], $3::text[])");
    expect(calls[0].params).toEqual([
      42,
      ["csp-missing--a", "hsts-missing--b"],
      ["https://example.com/", "https://example.com/"],
    ]);
  });

  it("collapses a duplicated (findingId, findingUrl) pair", async () => {
    // A single INSERT ... ON CONFLICT cannot touch the same row twice, and
    // the selection UI can hand the same finding over twice when it appears
    // on two pages of one scan.
    await POST(
      postRequest({ items: [ITEMS[0], ITEMS[0], ITEMS[1]], status: "fixed" }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].params[1]).toEqual(["csp-missing--a", "hsts-missing--b"]);
    expect(calls[0].params[2]).toEqual([
      "https://example.com/",
      "https://example.com/",
    ]);
  });
});
