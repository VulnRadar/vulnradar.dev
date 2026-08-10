/**
 * Route-level tests for PATCH /api/v3/webhooks/[id] -- edit/pause.
 *
 * Proves the ownership predicate reaches the real SQL (WHERE id = $n AND
 * user_id = $n) rather than a mocked stand-in, same approach as
 * tests/app/api/v3/keys/[id]/revoke/route.test.ts and
 * tests/app/api/v3/history/[id]/route.test.ts for the same class of route.
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

const mockValidateScanTarget = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
}));

const { PATCH } = await import("@/app/api/v3/webhooks/[id]/route");

function params(id = "10") {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/webhooks/10", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 7, email: "owner@example.com" });
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
});

describe("PATCH /api/v3/webhooks/[id]", () => {
  it("rejects an unauthenticated request before touching the database", async () => {
    mockGetSession.mockResolvedValue(null);

    const res = await PATCH(patchRequest({ active: false }), params());

    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric id before touching the database", async () => {
    const res = await PATCH(
      patchRequest({ active: false }),
      params("not-a-number"),
    );

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an empty body (nothing to update)", async () => {
    const res = await PATCH(patchRequest({}), params());

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean active value", async () => {
    const res = await PATCH(patchRequest({ active: "yes" }), params());

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("pauses a webhook the caller owns, scoping the UPDATE by id AND user_id", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://example.com/hook",
          name: "Prod",
          type: "generic",
          active: false,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const res = await PATCH(patchRequest({ active: false }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.active).toBe(false);

    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("active = $1");
    expect(sql).toContain("WHERE id = $2 AND user_id = $3");
    expect(sqlParams).toEqual([false, 10, 7]);
  });

  it("a webhook ID owned by another user returns 404, proving the ownership predicate reaches the DB", async () => {
    // The UPDATE ... WHERE id = $n AND user_id = $n matched nothing because
    // webhook 10 belongs to a different user_id than the caller's (7).
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await PATCH(patchRequest({ active: true }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Webhook not found");

    const [, sqlParams] = mockQuery.mock.calls[0];
    expect(sqlParams).toEqual([true, 10, 7]);
  });

  it("resumes a paused webhook", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://example.com/hook",
          name: "Prod",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const res = await PATCH(patchRequest({ active: true }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.active).toBe(true);
  });

  it("edits name and url together, re-validating the new URL through validateScanTarget", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://hooks.slack.com/services/x/y/z",
          name: "Slack Alerts",
          type: "slack",
          active: true,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const res = await PATCH(
      patchRequest({
        name: "Slack Alerts",
        url: "https://hooks.slack.com/services/x/y/z",
      }),
      params("10"),
    );

    expect(res.status).toBe(200);
    expect(mockValidateScanTarget).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/x/y/z",
    );

    const [sql, sqlParams] = mockQuery.mock.calls[0];
    expect(sql).toContain("url = $1");
    expect(sql).toContain("name = $2");
    // Changing the URL re-runs auto-detection (same as creation), so the
    // type column is re-written too even though this request didn't send
    // `type` explicitly.
    expect(sql).toContain("type = $3");
    expect(sqlParams).toEqual([
      "https://hooks.slack.com/services/x/y/z",
      "Slack Alerts",
      "slack",
      10,
      7,
    ]);
  });

  it("rejects a non-HTTPS URL without querying the database", async () => {
    const res = await PATCH(
      patchRequest({ url: "http://example.com/hook" }),
      params("10"),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/HTTPS/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects an SSRF-blocked URL without querying the database", async () => {
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "Domain resolves to internal IP address.",
    });

    const res = await PATCH(
      patchRequest({ url: "https://internal.example.com/hook" }),
      params("10"),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/internal IP/);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
