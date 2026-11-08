/**
 * Route-level tests for POST /api/v3/webhooks: secret generation/exposure
 * and the plan-tier webhook cap.
 *
 * getUserPlanLimits (lib/billing/plan-limits.ts) is REAL here, same
 * approach as tests/app/api/v3/schedules/route.test.ts and
 * tests/app/api/v3/keys/route.test.ts -- only its DB/setting touch points
 * (getSetting/getSettings, getUserPlan) are mocked, so a test that proves
 * "plan X gets capped at N webhooks" is proving the real resolver + the
 * real withinPlanLimit() check in the route, not a hand-rolled stand-in.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { decryptApiKey } from "@/lib/auth/crypto";

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
  safeFetch: vi.fn(),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
}));

const mockSendNotificationEmail = vi.fn();
vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: (...args: unknown[]) =>
    mockSendNotificationEmail(...args),
}));

const mockGetSetting = vi.fn();
const mockGetFeatureWebhooks = vi.fn();
async function resolveFromRegistry(keys: string[]) {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return Object.fromEntries(
    keys.map((k) => [
      k,
      SETTINGS_REGISTRY[k as keyof typeof SETTINGS_REGISTRY].default,
    ]),
  );
}
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: async (key: string) => {
    if (key === "BILLING_ENABLED") return mockGetSetting();
    if (key === "FEATURE_WEBHOOKS") return mockGetFeatureWebhooks();
    const [resolved] = Object.values(await resolveFromRegistry([key]));
    return resolved;
  },
  getSettings: (keys: string[]) => resolveFromRegistry(keys),
}));

const mockGetUserPlan = vi.fn();
vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  getUserPlan: (...args: unknown[]) => mockGetUserPlan(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limiting/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET, POST, PATCH, DELETE } =
  await import("@/app/api/v3/webhooks/route");

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/webhooks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/webhooks", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function deleteRequest(body: unknown) {
  return new NextRequest("http://localhost/api/v3/webhooks", {
    method: "DELETE",
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
  mockSendNotificationEmail.mockReset();
  mockSendNotificationEmail.mockResolvedValue(undefined);
  mockGetSetting.mockReset();
  mockGetSetting.mockResolvedValue(true); // billing enabled
  mockGetFeatureWebhooks.mockReset();
  mockGetFeatureWebhooks.mockResolvedValue(true);
  mockGetUserPlan.mockReset();
  mockGetUserPlan.mockResolvedValue("pro_supporter"); // webhooks: 5
  mockCheckRateLimit.mockReset();
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 5,
    retryAfterSeconds: 0,
  });
});

describe("GET /api/v3/webhooks: what a teammate may see", () => {
  const SECRET_URL = "https://discord.com/api/webhooks/123/s3cr3t-token";

  function teamRow() {
    return { id: 2, url: SECRET_URL, name: "Ops", user_id: 99, team_id: 1 };
  }

  it.each([
    ["viewer", "user", true],
    ["admin", "super_admin", true],
    ["member", "user", false],
    ["admin", "user", false],
    ["owner", "user", false],
  ])(
    "team role %s on a webhook owned by a %s: redacted=%s",
    async (teamRole, ownerRole, redacted) => {
      mockQuery.mockResolvedValueOnce({ rows: [teamRow()] });
      mockQuery.mockResolvedValueOnce({ rows: [{ role: teamRole }] });
      mockQuery.mockResolvedValueOnce({ rows: [{ role: ownerRole }] });

      const res = await GET();
      const { webhooks } = await res.json();

      expect(webhooks[0].url_host).toBe("discord.com");
      if (redacted) {
        expect(webhooks[0].url).toBeNull();
        expect(JSON.stringify(webhooks)).not.toContain("s3cr3t-token");
      } else {
        expect(webhooks[0].url).toBe(SECRET_URL);
      }
    },
  );

  it("always shows the creator their own URL, without asking about a team", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...teamRow(), user_id: 7 }],
    });

    const { webhooks } = await (await GET()).json();

    expect(webhooks[0].url).toBe(SECRET_URL);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("asks once per creator and team, however many webhooks they share", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [teamRow(), { ...teamRow(), id: 3 }, { ...teamRow(), id: 4 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "viewer" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });

    const { webhooks } = await (await GET()).json();

    expect(webhooks.map((w: { url: unknown }) => w.url)).toEqual([
      null,
      null,
      null,
    ]);
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

describe("PATCH /api/v3/webhooks (test send): limits and failure answers", () => {
  const STORED = {
    id: 10,
    url: "https://hooks.example.com/in/abc",
    name: "Prod",
    type: "generic",
    user_id: 7,
    team_id: null,
    secret: "stored-signing-secret",
  };

  async function fetchMock() {
    const { safeFetch } = await import("@/lib/scanner/safe-fetch");
    vi.mocked(safeFetch).mockReset();
    return vi.mocked(safeFetch);
  }

  function refuseNextLimit(retryAfterSeconds = 120) {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds,
    });
  }

  it("is off when FEATURE_WEBHOOKS is off, before any database or network work", async () => {
    mockGetFeatureWebhooks.mockResolvedValue(false);
    const safeFetch = await fetchMock();

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: "Webhooks are disabled on this deployment.",
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("refuses over the per-user limit before reading the webhook or resolving DNS", async () => {
    refuseNextLimit();

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect((await res.json()).success).toBe(false);
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      key: "webhook-test:7",
      maxAttempts: 10,
      windowSeconds: 600,
    });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockValidateScanTarget).not.toHaveBeenCalled();
  });

  it("counts every target on one registrable domain together", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED] });
    const safeFetch = await fetchMock();
    safeFetch.mockResolvedValue(new Response("ok", { status: 200 }));

    await PATCH(patchRequest({ id: 10 }));

    expect(mockCheckRateLimit).toHaveBeenLastCalledWith({
      key: "webhook-test-target:example.com",
      maxAttempts: 30,
      windowSeconds: 3600,
    });
  });

  it("refuses over the per-target limit without sending anything", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED] });
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    });
    refuseNextLimit(600);
    const safeFetch = await fetchMock();

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("600");
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("does not spend a shared chat platform's bucket on one account's clicks", async () => {
    // Every Discord webhook on the deployment shares discord.com. One bucket
    // for the domain would let a single account use up everyone's Test button.
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          ...STORED,
          type: "discord",
          url: "https://discord.com/api/webhooks/123/s3cr3t-token",
        },
      ],
    });
    const safeFetch = await fetchMock();
    safeFetch.mockResolvedValue(new Response("ok", { status: 200 }));

    await PATCH(patchRequest({ id: 10 }));

    const key = mockCheckRateLimit.mock.lastCall?.[0].key as string;
    expect(key).toBe("webhook-test-target:id-10");
    expect(key).not.toContain("s3cr3t-token");
  });

  it.each([
    "https://discord.com/api/webhooks/123/s3cr3t-token/github",
    "https://discord.com/api/webhooks/123/s3cr3t-token/slack",
    "https://hooks.slack.com/services/T0/B0/s3cr3t-token",
  ])("counts %s per webhook, not per shared domain", async (url) => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...STORED, url }] });
    const safeFetch = await fetchMock();
    safeFetch.mockResolvedValue(new Response("ok", { status: 200 }));

    await PATCH(patchRequest({ id: 10 }));

    expect(mockCheckRateLimit.mock.lastCall?.[0].key).toBe(
      "webhook-test-target:id-10",
    );
  });

  it.each([
    ["a trailing dot", "https://hooks.example.com./in/abc", "example.com"],
    ["an IP address", "https://8.8.4.4/in/abc", "8.8.4.4"],
  ])("buckets %s by the host it really is", async (_label, url, scope) => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...STORED, url }] });
    const safeFetch = await fetchMock();
    safeFetch.mockResolvedValue(new Response("ok", { status: 200 }));

    await PATCH(patchRequest({ id: 10 }));

    expect(mockCheckRateLimit).toHaveBeenLastCalledWith({
      key: `webhook-test-target:${scope}`,
      maxAttempts: 30,
      windowSeconds: 3600,
    });
  });

  it.each([
    [30, "under a minute"],
    [60, "a minute"],
    [120, "2 minutes"],
    [3599, "60 minutes"],
  ])("after %i seconds of refusal says %s", async (retryAfter, wait) => {
    refuseNextLimit(retryAfter);

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.headers.get("Retry-After")).toBe(String(retryAfter));
    expect(await res.json()).toEqual({
      success: false,
      error: `Too many test deliveries. Try again in ${wait}.`,
      code: "RATE_LIMITED",
    });
  });

  it("answers 502, not a refusal, for a name that no longer resolves", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED] });
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "DNS resolution failed, cannot verify target is safe to scan.",
      code: "unreachable",
    });
    const safeFetch = await fetchMock();

    const res = await PATCH(patchRequest({ id: 10 }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json).toEqual({
      success: false,
      error: "Could not connect to your endpoint.",
    });
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("does not let someone without write access spend the target's bucket", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...STORED, user_id: 99 }] });

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.status).toBe(404);
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
  });

  it("validates the target exactly once, with a fixed sentence when it is refused", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED] });
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "Scanning internal hostnames (db.internal) is not allowed.",
    });

    const res = await PATCH(patchRequest({ id: 10 }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).not.toContain("db.internal");
    expect(mockValidateScanTarget).toHaveBeenCalledTimes(1);
  });

  it("answers 502, not 400, when the endpoint returns a non-2xx", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED] });
    const safeFetch = await fetchMock();
    safeFetch.mockResolvedValue(
      new Response("y".repeat(5000), { status: 500 }),
    );

    const res = await PATCH(patchRequest({ id: 10 }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.success).toBe(false);
    expect(json.error).toBe(`Webhook returned 500: ${"y".repeat(100)}`);
  });

  it("reads at most the capped prefix of a large error body", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED] });
    const safeFetch = await fetchMock();
    let pulls = 0;
    safeFetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            pulls += 1;
            controller.enqueue(new TextEncoder().encode("z".repeat(400)));
            if (pulls > 1000) controller.close();
          },
        }),
        { status: 500 },
      ),
    );

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.status).toBe(502);
    expect(pulls).toBeLessThan(50);
  });

  it.each([
    ["timeout", 504],
    ["tls", 502],
    ["unreachable", 502],
    ["cross_host_redirect", 502],
    ["redirect", 502],
    ["blocked", 400],
    [undefined, 502],
  ])(
    "maps a %s failure to %i and a sentence of its own, never the raw message",
    async (code, status) => {
      mockQuery.mockResolvedValueOnce({ rows: [STORED] });
      const safeFetch = await fetchMock();
      safeFetch.mockRejectedValue(
        Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:443"), { code }),
      );

      const res = await PATCH(patchRequest({ id: 10 }));
      const json = await res.json();

      expect(res.status).toBe(status);
      expect(json.success).toBe(false);
      expect(json.error).not.toContain("10.0.0.5");
      expect(json.error).not.toContain("ECONNREFUSED");
    },
  );

  it("signs the test with the stored secret and sends what a real delivery sends", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [STORED] });
    const safeFetch = await fetchMock();
    safeFetch.mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("secret");
    expect(await JSON.stringify(res.headers)).not.toContain(STORED.secret);

    const init = safeFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(headers["User-Agent"]).toBe("VulnRadar-Webhook/1.0");
    expect(headers["X-VulnRadar-Signature"]).toBe(
      `sha256=${createHmac("sha256", STORED.secret).update(body, "utf8").digest("hex")}`,
    );
    expect(headers["X-VulnRadar-Signature-V2"]).toMatch(
      /^t=[0-9]{10},v1=[0-9a-f]{64}$/,
    );
    expect(headers["X-VulnRadar-Event"]).toBe("test");
    expect(headers["X-VulnRadar-Attempt"]).toBe("1");
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const parsed = JSON.parse(body);
    expect(parsed.event).toBe("test");
    expect(parsed.id).toBe(headers["X-VulnRadar-Delivery"]);
    expect(parsed.api_version).toBe("1");
    expect(parsed).not.toHaveProperty("data");
  });

  it("still sends a test for a legacy row with no secret, unsigned", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...STORED, secret: null }] });
    const safeFetch = await fetchMock();
    safeFetch.mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.status).toBe(200);
    const init = safeFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-VulnRadar-Signature"]).toBeUndefined();
    expect(headers["X-VulnRadar-Delivery"]).toBeDefined();
  });
});

describe("GET /api/v3/webhooks", () => {
  it("never selects the secret column", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain("secret");
  });

  it("lists both the caller's own webhooks and any team-shared ones in a single query", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 1, url: "https://a.example.com", user_id: 7, team_id: null },
        { id: 2, url: "https://b.example.com", user_id: 99, team_id: 1 },
      ],
    });
    mockQuery.mockResolvedValue({ rows: [{ role: "member" }] });

    const res = await GET();
    const json = await res.json();

    // Named-key envelope, not the bare array this used to return, matching
    // every other collection endpoint. AUDIT-013#dup-08.
    expect(Object.keys(json)).toEqual(["webhooks"]);
    expect(json.webhooks).toHaveLength(2);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("user_id = $1");
    expect(sql).toContain("team_id IN (SELECT team_id FROM team_members");
    expect(params).toEqual([7]);
  });

  it("selects user_id so a caller can tell their own webhook from a teammate's", async () => {
    // Both kinds are in this list, and PATCH /webhooks/[id] answers 403 to a
    // teammate who sends teamId. The profile UI needs the creator to decide
    // which rows get a team picker at all.
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await GET();

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain("user_id, team_id");
  });
});

describe("PATCH /api/v3/webhooks (send a test payload)", () => {
  it("requires a webhook id", async () => {
    const res = await PATCH(patchRequest({}));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 404 for a webhook the caller has no access to", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: null }] });

    const res = await PATCH(patchRequest({ id: 10 }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe("Webhook not found");
  });

  it("returns 403 for a viewer-role team co-member (read access, not write)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 99, team_id: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "viewer" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });

    const res = await PATCH(patchRequest({ id: 10 }));
    expect(res.status).toBe(403);
  });

  it("lets the owner send a test payload", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          url: "https://example.com/hook",
          name: "Prod",
          type: "generic",
          user_id: 7,
          team_id: null,
        },
      ],
    });
    const { safeFetch } = await import("@/lib/scanner/safe-fetch");
    vi.mocked(safeFetch).mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await PATCH(patchRequest({ id: 10 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  // A row saved as discord before Discord's /slack and /github endpoints were
  // told apart keeps that type. Its scan notifications already pick the
  // payload by deliveryFormat; the test message has to match, or it arrives
  // as an embed those endpoints do not read.
  it.each<[string, string, string, (body: Record<string, unknown>) => void]>([
    [
      "a stored discord row on Discord's /slack endpoint gets the Slack payload",
      "discord",
      "https://discord.com/api/webhooks/1/tok/slack",
      (body) => {
        expect(body).toHaveProperty("blocks");
        expect(body).toHaveProperty("text");
        expect(body).not.toHaveProperty("embeds");
      },
    ],
    [
      "a stored discord row on Discord's /github endpoint gets the generic payload",
      "discord",
      "https://discord.com/api/webhooks/1/tok/github",
      (body) => {
        expect(body).toMatchObject({ event: "test" });
        expect(body).not.toHaveProperty("embeds");
      },
    ],
    [
      "an ordinary Discord webhook still gets an embed",
      "discord",
      "https://discord.com/api/webhooks/1/tok",
      (body) => expect(body).toHaveProperty("embeds"),
    ],
    [
      "a discord type pinned on a proxy is kept",
      "discord",
      "https://proxy.example/hooks/slack",
      (body) => expect(body).toHaveProperty("embeds"),
    ],
  ])("%s", async (_label, type, url, check) => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 10, url, name: "Prod", type, user_id: 7, team_id: null }],
    });
    const { safeFetch } = await import("@/lib/scanner/safe-fetch");
    vi.mocked(safeFetch).mockReset();
    vi.mocked(safeFetch).mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await PATCH(patchRequest({ id: 10 }));

    expect(res.status).toBe(200);
    const [sentTo, init] = vi.mocked(safeFetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(sentTo).toBe(url);
    check(JSON.parse(init.body as string));
  });
});

describe("DELETE /api/v3/webhooks", () => {
  it("returns 404 when the webhook doesn't exist", async () => {
    // This test's NAME always said 404; its body asserted 200, which is what
    // the route did. The name was the right one. Answering 200 for "no such
    // id" while answering 404 for "exists, not yours" (the test below) handed
    // a caller exactly the distinction that 404 is there to hide: a 200 meant
    // the id is free, a 404 meant somebody has it.
    mockQuery.mockResolvedValueOnce({ rows: [] }); // SELECT: no row

    const res = await DELETE(deleteRequest({ id: 999 }));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.error).toMatch(/not found/i);
    // And nothing is deleted: the SELECT is the only query issued.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("blocks deletion by a caller with no access", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: "Prod", user_id: 99, team_id: null }],
    });

    const res = await DELETE(deleteRequest({ id: 10 }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toMatch(/permission/i);
    // No DELETE query issued past the initial SELECT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("blocks deletion by a viewer-role team co-member with 403 (they can see it exists)", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: "Prod", user_id: 99, team_id: 1 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "viewer" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });

    const res = await DELETE(deleteRequest({ id: 10 }));
    expect(res.status).toBe(403);
  });

  it("lets an admin-role team co-member delete a team-assigned webhook", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: "Prod", user_id: 99, team_id: 1 }],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "admin" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ role: "user" }] });
    mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // DELETE

    const res = await DELETE(deleteRequest({ id: 10 }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });
});

describe("POST /api/v3/webhooks: FEATURE_WEBHOOKS settings wiring", () => {
  /**
   * Settings-wiring regression: FEATURE_WEBHOOKS is a registry-backed
   * deployment-wide kill switch. It used to resolve into a dead
   * FEATURES.WEBHOOKS object nothing ever read, so an admin disabling
   * webhooks in /admin had zero effect. This proves the live (mocked)
   * value actually gates webhook creation.
   */
  it("rejects webhook creation when FEATURE_WEBHOOKS is disabled", async () => {
    mockGetFeatureWebhooks.mockResolvedValue(false);

    const res = await POST(
      postRequest({ url: "https://example.com/hook", type: "auto" }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/disabled/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/webhooks: secret", () => {
  it("generates a 64-hex-char secret, inserts it, and returns it once", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // count
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
        },
      ],
    }); // INSERT

    const res = await POST(
      postRequest({ url: "https://example.com/hook", type: "auto" }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.secret).toMatch(/^[0-9a-f]{64}$/);

    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain("INSERT INTO webhooks");
    expect(insertCall[0]).toContain("secret");
    // No RETURNING secret: the column holds ciphertext now
    // (AUDIT-009#webhook-01), so reading it back would hand the caller the
    // ciphertext instead of the secret they have to configure.
    expect(insertCall[0]).not.toContain(
      "RETURNING id, url, name, type, active, created_at, secret",
    );
    const insertedSecret = insertCall[1][4];
    expect(insertedSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores the secret encrypted, not in plaintext, when an encryption key is configured", async () => {
    // AUDIT-009#webhook-01: webhooks.secret was the only long-lived
    // reversible secret still written to the database as plain text.
    const previous = process.env.API_KEY_ENCRYPTION_KEY;
    process.env.API_KEY_ENCRYPTION_KEY = "a".repeat(64);
    try {
      mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] }); // count
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // INSERT

      const res = await POST(
        postRequest({ url: "https://example.com/hook", type: "auto" }),
      );
      const json = await res.json();

      const stored = mockQuery.mock.calls[1][1][4] as string;
      expect(stored).not.toBe(json.secret);
      expect(stored).not.toMatch(/^[0-9a-f]{64}$/);
      // Reversible, not a hash: signing needs the raw secret back.
      expect(decryptApiKey(stored)).toBe(json.secret);
    } finally {
      if (previous === undefined) delete process.env.API_KEY_ENCRYPTION_KEY;
      else process.env.API_KEY_ENCRYPTION_KEY = previous;
    }
  });

  it("generates a different secret for every webhook", async () => {
    mockQuery.mockResolvedValue({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(postRequest({ url: "https://example.com/hook-a" }));
    const first = mockQuery.mock.calls[1][1][4];

    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    await POST(postRequest({ url: "https://example.com/hook-b" }));
    const second = mockQuery.mock.calls[3][1][4];

    expect(first).not.toBe(second);
  });
});

describe("POST /api/v3/webhooks: plan-tier limit", () => {
  it("carries the cap into the INSERT, so a lost race cannot exceed it", async () => {
    // Count-then-insert is check-then-act: two requests that both read the
    // same count before either writes both pass the gate, and the account
    // ends up holding more webhooks than its plan allows with nothing left
    // to notice it afterwards. The cap is re-applied inside the statement,
    // the same shape schedules/route.ts uses.
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await POST(postRequest({ url: "https://example.com/hook" }));

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("INSERT INTO webhooks");
    expect(sql).toContain("SELECT COUNT(*) FROM webhooks WHERE user_id = $1");
    // Pro Supporter's cap, bound as the last parameter.
    expect(params[5]).toBe(5);
  });

  it("answers a refusal from inside the INSERT the way the count answers it", async () => {
    // The guard held: a concurrent request took the last slot between the
    // count and this statement, so the INSERT wrote nothing and returned no
    // row. The old code spread an undefined row into the response.
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 4 }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("5 Webhooks");
  });

  it("binds a null cap when the plan is unlimited, so the guard always holds", async () => {
    mockGetSetting.mockResolvedValue(false); // billing off
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 99 }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    await POST(postRequest({ url: "https://example.com/hook" }));

    expect(mockQuery.mock.calls[1][1][5]).toBeNull();
  });

  it("blocks creation once a Pro Supporter (limit 5) already has 5 webhooks", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 5 }] });

    const res = await POST(postRequest({ url: "https://example.com/hook-6" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("5 Webhooks");
    // Only the count query ran; no INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("free plan (limit 1) can create its first webhook but not a second", async () => {
    // Free used to allow 0 webhooks; it now gets a real, if modest,
    // allowance (webhooks: 1) like every other limit free is eligible
    // for -- mirrors the core_supporter (limit 1) test below exactly,
    // since they now share the same numeric cap.
    mockGetUserPlan.mockResolvedValue("free");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
          secret: "x".repeat(64),
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    expect(res.status).toBe(201);

    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    const res2 = await POST(postRequest({ url: "https://example.com/hook-2" }));
    const json2 = await res2.json();
    expect(res2.status).toBe(400);
    expect(json2.error).toContain("1 Webhooks");
  });

  it("core_supporter (limit 1) can create its first webhook but not a second", async () => {
    mockGetUserPlan.mockResolvedValue("core_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
          secret: "x".repeat(64),
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    expect(res.status).toBe(201);

    mockQuery.mockReset();
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 1 }] });
    const res2 = await POST(postRequest({ url: "https://example.com/hook-2" }));
    const json2 = await res2.json();
    expect(res2.status).toBe(400);
    expect(json2.error).toContain("1 Webhooks");
  });

  it("does not cap creation for an unlimited (elite) plan", async () => {
    mockGetUserPlan.mockResolvedValue("elite_supporter");
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 42 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 99,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
          secret: "x".repeat(64),
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    expect(res.status).toBe(201);
  });

  it("does not cap creation when billing is disabled", async () => {
    mockGetSetting.mockResolvedValue(false);
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 999 }] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 100,
          url: "https://example.com/hook",
          name: "Default",
          type: "generic",
          active: true,
          created_at: new Date().toISOString(),
          secret: "x".repeat(64),
        },
      ],
    });

    const res = await POST(postRequest({ url: "https://example.com/hook" }));
    expect(res.status).toBe(201);
    expect(mockGetUserPlan).not.toHaveBeenCalled();
  });
});
