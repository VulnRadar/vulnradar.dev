/**
 * Opening /admin?tab=users&user=999 for an account the API refuses.
 *
 * fetchUserDetail stored whatever came back as the selected user. A 404 or a
 * 403 body has no `user`, so the panel read `.user.id` off it during render and
 * the whole admin panel fell into "Admin panel error" until a reload, from a
 * routine link click. The page now asks loadUserDetail, which only ever hands
 * back a record or a message, toasts the message, shows the list, and takes
 * the dead id out of the address bar.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canOpenUserRecords,
  loadUserDetail,
  userDetailFailure,
} from "@/components/admin/users/user-detail-fetch";
import { isUserDetailResponse } from "@/components/admin/types.responses";

function respond(status: number, body: unknown, json = true): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!json) throw new SyntaxError("Unexpected token <");
      return body;
    },
  })) as unknown as typeof fetch;
}

const RECORD = { user: { id: 7, email: "ada@example.com" }, badges: [] };

describe("loadUserDetail", () => {
  it("hands back the record for a 200 that carries one", async () => {
    const out = await loadUserDetail(7, false, respond(200, RECORD));
    expect(out).toEqual({ ok: true, detail: RECORD });
  });

  it("turns a 404 into a message, not a record", async () => {
    const out = await loadUserDetail(
      999,
      false,
      respond(404, { error: "User not found" }),
    );
    expect(out).toEqual({
      ok: false,
      status: 404,
      message: "That account no longer exists.",
    });
  });

  it("turns a 403 into a message, not a record", async () => {
    const out = await loadUserDetail(
      999,
      false,
      respond(403, { error: "Forbidden" }),
    );
    expect(out).toEqual({
      ok: false,
      status: 403,
      message: "Your role cannot view accounts.",
    });
  });

  it("does not trust a 200 whose body is not a record", async () => {
    const out = await loadUserDetail(7, false, respond(200, { error: "x" }));
    expect(out.ok).toBe(false);
  });

  it("survives a gateway page that is not JSON", async () => {
    const out = await loadUserDetail(7, false, respond(502, null, false));
    expect(out).toEqual({
      ok: false,
      status: 502,
      message: "Failed to load user details.",
    });
  });

  it("survives a network failure", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const out = await loadUserDetail(7, false, failing);
    expect(out).toEqual({
      ok: false,
      status: 0,
      message: "Failed to load user details.",
    });
  });

  it("marks a reload after the operator's own write, and only that", async () => {
    const fetchImpl = respond(200, RECORD);
    await loadUserDetail(7, true, fetchImpl);
    await loadUserDetail(7, false, fetchImpl);
    const urls = (
      fetchImpl as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => String(c[0]));
    expect(urls[0]).toContain("section=user-detail&userId=7&refresh=1");
    expect(urls[1]).toContain("section=user-detail&userId=7");
    expect(urls[1]).not.toContain("refresh");
  });
});

describe("error bodies are never an account", () => {
  it("rejects the bodies the route answers a refusal with", () => {
    expect(isUserDetailResponse({ error: "Forbidden" })).toBe(false);
    expect(isUserDetailResponse(null)).toBe(false);
  });

  it("accepts a record", () => {
    expect(isUserDetailResponse(RECORD as never)).toBe(true);
  });

  it("falls back to the body's own error for a status it has no words for", () => {
    expect(userDetailFailure(500, { error: "Database unavailable" })).toBe(
      "Database unavailable",
    );
  });
});

describe("the page acts on a refusal", () => {
  const page = readFileSync(
    join(__dirname, "..", "..", "..", "app", "admin", "page.tsx"),
    "utf8",
  );
  const start = page.indexOf("const fetchUserDetail = useCallback(");
  const body = page.slice(start, page.indexOf("const fetchHealth", start));

  it("toasts the message and clears ?user= instead of storing the body", () => {
    expect(body).toContain("loadUserDetail(");
    expect(body).toContain('showToast(outcome.message, "error")');
    expect(body).toContain('setQueryParam("user", null, { replace: true })');
    expect(body).not.toContain("updateUrlWithUser(null, activeTab)");
    expect(body.indexOf("setSelectedUser(outcome.detail)")).toBeLessThan(
      body.indexOf("showToast(outcome.message"),
    );
  });

  it("guards the scroll effect on the record's id", () => {
    expect(page).toContain("selectedUser?.user?.id");
  });
});

describe("user links", () => {
  it("are offered only to a role that can open an account", () => {
    expect(canOpenUserRecords("moderator")).toBe(true);
    expect(canOpenUserRecords("admin")).toBe(true);
    // ops sees the queue and the audit log but holds no VIEW_USERS.
    expect(canOpenUserRecords("ops")).toBe(false);
    expect(canOpenUserRecords(undefined)).toBe(false);
  });
});
