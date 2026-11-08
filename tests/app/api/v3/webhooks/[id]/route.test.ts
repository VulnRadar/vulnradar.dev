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

  it("pauses a webhook the caller owns", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, team_id: null }] }); // ownership SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://example.com/hook",
          name: "Prod",
          type: "generic",
          active: false,
          team_id: null,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const res = await PATCH(patchRequest({ active: false }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.active).toBe(false);

    const [sql, sqlParams] = mockQuery.mock.calls[1];
    expect(sql).toContain("active = $1");
    expect(sql).toContain("WHERE id = $2");
    expect(sqlParams).toEqual([false, 10]);
  });

  it("a webhook ID owned by another user (no shared team) returns 404, proving the access check reaches the DB", async () => {
    // The ownership SELECT found the row, but it belongs to a different
    // user_id (99) than the caller's (7), and there's no team_id to check
    // co-membership against.
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: null }] });

    const res = await PATCH(patchRequest({ active: true }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Webhook not found");
    expect(mockQuery).toHaveBeenCalledTimes(1); // no UPDATE attempted
  });

  it("a viewer-role team co-member gets 403, not 404, since they can legitimately see the webhook exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: 1 }] }); // ownership SELECT
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "viewer" }] }); // team_members lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] }); // owner role lookup (not god_mode)

    const res = await PATCH(patchRequest({ active: true }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/permission/i);
  });

  it.each(["owner", "admin", "member"])(
    "a %s-role team co-member can edit a team-assigned webhook they don't own",
    async (role) => {
      mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: 1 }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ role }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 10,
            url: "https://example.com/hook",
            name: "Prod",
            type: "generic",
            active: false,
            team_id: 1,
            created_at: new Date().toISOString(),
          },
        ],
      });

      const res = await PATCH(patchRequest({ active: false }), params("10"));
      expect(res.status).toBe(200);
    },
  );

  it("resumes a paused webhook", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, team_id: null }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://example.com/hook",
          name: "Prod",
          type: "generic",
          active: true,
          team_id: null,
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
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, team_id: null }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://hooks.slack.com/services/x/y/z",
          name: "Slack Alerts",
          type: "slack",
          active: true,
          team_id: null,
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

    const [sql, sqlParams] = mockQuery.mock.calls[1];
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
    ]);
  });

  it("assigns a webhook to a team the caller can manage", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, team_id: null }] }); // ownership SELECT
    mockQuery.mockResolvedValueOnce({
      rows: [{ team_id: 1, role: "owner" }],
    }); // getAssignableTeamIds
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://example.com/hook",
          name: "Prod",
          type: "generic",
          active: true,
          team_id: 1,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const res = await PATCH(patchRequest({ teamId: 1 }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.team_id).toBe(1);
  });

  it("rejects assigning a webhook to a team the caller cannot manage", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, team_id: null }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ team_id: 2, role: "viewer" }] });

    const res = await PATCH(patchRequest({ teamId: 2 }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/cannot assign/i);
  });

  it("rejects a non-owner team member trying to change the team assignment", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: 1 }] }); // owned by someone else
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] }); // caller's team_members role
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] }); // owner role

    const res = await PATCH(patchRequest({ teamId: 3 }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/owner can change/i);
  });

  it("unassigns a webhook from its team via teamId: null", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, team_id: 1 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://example.com/hook",
          name: "Prod",
          type: "generic",
          active: true,
          team_id: null,
          created_at: new Date().toISOString(),
        },
      ],
    });

    const res = await PATCH(patchRequest({ teamId: null }), params("10"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.team_id).toBe(null);
  });

  it("does not grant write access to a co-member when the webhook's owner is a super_admin", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] }); // caller's team role
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "super_admin" }] }); // owner's role: god_mode

    const res = await PATCH(patchRequest({ active: false }), params("10"));
    expect(res.status).toBe(403);
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

  it("rejects an SSRF-blocked URL from the owner without writing anything", async () => {
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "Domain resolves to internal IP address.",
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, team_id: null }] });

    const res = await PATCH(
      patchRequest({ url: "https://internal.example.com/hook" }),
      params("10"),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/internal IP/);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /api/v3/webhooks/[id]: the URL and type belong to the creator", () => {
  const OWNER_ONLY = "Only this webhook's owner can change its URL or type.";

  /** Caller 7 holds `role` on team 1; the webhook was created by user 99. */
  function coMember(role = "admin") {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });
  }

  it.each(["owner", "admin", "member"])(
    "refuses a team %s repointing a teammate's webhook",
    async (role) => {
      coMember(role);

      const res = await PATCH(
        patchRequest({ url: "https://attacker.example/collect" }),
        params(),
      );

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(OWNER_ONLY);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    },
  );

  it.each(["generic", "discord", "auto"])(
    "refuses a co-member changing the type to %s",
    async (type) => {
      coMember();

      const res = await PATCH(patchRequest({ type }), params());

      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe(OWNER_ONLY);
      expect(mockQuery).toHaveBeenCalledTimes(3);
    },
  );

  it("refuses the whole request when a rename arrives with a new URL", async () => {
    coMember();

    const res = await PATCH(
      patchRequest({ name: "Renamed", url: "https://attacker.example/x" }),
      params(),
    );

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it("does no DNS work for a co-member's URL", async () => {
    coMember();

    await PATCH(
      patchRequest({ url: "https://probe.internal.example/" }),
      params(),
    );

    expect(mockValidateScanTarget).not.toHaveBeenCalled();
  });

  it("does no DNS work for a caller with no access at all", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: null }] });

    const res = await PATCH(
      patchRequest({ url: "https://probe.internal.example/" }),
      params(),
    );

    expect(res.status).toBe(404);
    expect(mockValidateScanTarget).not.toHaveBeenCalled();
  });

  it("lets a co-member with write access rename and pause it", async () => {
    coMember("member");
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 10, name: "Renamed", active: false }],
    });

    const res = await PATCH(
      patchRequest({ name: "Renamed", active: false }),
      params(),
    );

    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[3];
    expect(sql).toContain("name =");
    expect(sql).toContain("active =");
    expect(sql).not.toContain("url =");
  });

  it("still lets the creator change both", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 7, team_id: 1 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 10, url: "https://hook.example/new", type: "slack" }],
    });

    const res = await PATCH(
      patchRequest({ url: "https://hook.example/new", type: "slack" }),
      params(),
    );

    expect(res.status).toBe(200);
    expect(mockValidateScanTarget).toHaveBeenCalledOnce();
  });

  describe("the redacted form of a URL", () => {
    it("refuses url: null, which is what a read-only teammate's row holds", async () => {
      const res = await PATCH(patchRequest({ url: null }), params());
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe(
        "url cannot be null. Send the full https:// address, or leave url out to keep the current one.",
      );
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("refuses the bare host that replaces it", async () => {
      const res = await PATCH(patchRequest({ url: "discord.com" }), params());

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid URL");
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
