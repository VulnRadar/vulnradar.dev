/**
 * What the webhook routes do with a body that is not a JSON object, an id that
 * is not exactly a row id, and a dependency that throws.
 *
 * `Number(idParam)` with an isInteger check let "1e3" through as webhook 1000,
 * "0x10" as 16 and 9999999999 as a value Postgres refuses with a 500. The body
 * routes threw on `{not json` or `null` before reading a field. None of the
 * handlers caught a throw, so each of these was a 500 with no JSON body.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: vi.fn(async () => ({ safe: true })),
  safeFetch: vi.fn(),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
  getUserAgent: vi.fn(async () => "test"),
}));

vi.mock("@/lib/notifications/notifications", () => ({
  sendNotificationEmail: vi.fn(async () => undefined),
}));

vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const read = (key: string) =>
    key === "BILLING_ENABLED"
      ? false
      : key.startsWith("FEATURE_")
        ? true
        : SETTINGS_REGISTRY[key as keyof typeof SETTINGS_REGISTRY]?.default;
  return {
    getSetting: async (key: string) => read(key),
    getSettings: async (keys: string[]) =>
      Object.fromEntries(keys.map((key) => [key, read(key)])),
  };
});

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));

vi.mock("@/lib/logging/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logging/log")>()),
  logError: vi.fn(),
}));

const webhooks = await import("@/app/api/v3/webhooks/route");
const webhook = await import("@/app/api/v3/webhooks/[id]/route");
const deliveries = await import("@/app/api/v3/webhooks/[id]/deliveries/route");
const rotate = await import("@/app/api/v3/webhooks/[id]/rotate-secret/route");

const BAD_BODIES = ["{not json", "null", "[]", '"a string"'];
const BAD_PATH_IDS = ["9999999999", "12abc", "1e3", "0x10", "1.5", "0", "-1"];
const BAD_BODY_IDS: unknown[] = [
  ...BAD_PATH_IDS,
  9999999999,
  1.5,
  -1,
  true,
  {},
];

function rawRequest(method: string, body: string, path = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v3/webhooks${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body,
  });
}

function jsonRequest(method: string, body: unknown, path = ""): NextRequest {
  return rawRequest(method, JSON.stringify(body), path);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42, email: "me@example.com" });
});

describe("a body that is not a JSON object", () => {
  const handlers: [string, (r: NextRequest) => Promise<Response>][] = [
    ["POST /webhooks", webhooks.POST],
    ["PATCH /webhooks", webhooks.PATCH],
    ["DELETE /webhooks", webhooks.DELETE],
    ["PATCH /webhooks/[id]", (r) => webhook.PATCH(r, params("10"))],
  ];
  for (const [label, handler] of handlers) {
    const method = label.split(" ")[0];
    for (const body of BAD_BODIES) {
      it(`${label} answers 400 to ${JSON.stringify(body)}`, async () => {
        const res = await handler(rawRequest(method, body, "/10"));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toEqual(expect.any(String));
        expect(mockQuery).not.toHaveBeenCalled();
      });
    }
  }

  it("PATCH /webhooks/[id] with no body still says there is nothing to update", async () => {
    const res = await webhook.PATCH(
      new NextRequest("http://localhost/api/v3/webhooks/10", {
        method: "PATCH",
      }),
      params("10"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Nothing to update");
  });
});

describe("an id that is not exactly a row id", () => {
  for (const id of BAD_PATH_IDS) {
    it(`PATCH /webhooks/${id} answers 400`, async () => {
      const res = await webhook.PATCH(
        jsonRequest("PATCH", { active: false }, `/${id}`),
        params(id),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid webhook id");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`GET /webhooks/${id}/deliveries answers 400`, async () => {
      const res = await deliveries.GET(
        new NextRequest(`http://localhost/api/v3/webhooks/${id}/deliveries`),
        params(id),
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`POST /webhooks/${id}/rotate-secret answers 400`, async () => {
      const res = await rotate.POST(
        new NextRequest(
          `http://localhost/api/v3/webhooks/${id}/rotate-secret`,
          { method: "POST" },
        ),
        params(id),
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  for (const id of BAD_BODY_IDS) {
    it(`PATCH /webhooks (test send) answers 400 to ${JSON.stringify(id)}`, async () => {
      const res = await webhooks.PATCH(jsonRequest("PATCH", { id }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid webhook id");
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it(`DELETE /webhooks answers 400 to ${JSON.stringify(id)}`, async () => {
      const res = await webhooks.DELETE(jsonRequest("DELETE", { id }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Invalid webhook id");
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }

  it("DELETE /webhooks asks for an id that is missing", async () => {
    // It used to look up `undefined`, find nothing and answer 404 as if a
    // webhook had been named.
    const res = await webhooks.DELETE(jsonRequest("DELETE", {}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Webhook ID is required");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  for (const teamId of [9999999999, 1.5, 0, -1, "5"]) {
    it(`PATCH /webhooks/[id] answers 400 to teamId ${JSON.stringify(teamId)}`, async () => {
      const res = await webhook.PATCH(
        jsonRequest("PATCH", { teamId }, "/10"),
        params("10"),
      );
      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  }
});

describe("a dependency that throws", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["GET /webhooks", () => webhooks.GET()],
    [
      "POST /webhooks",
      () =>
        webhooks.POST(
          jsonRequest("POST", { url: "https://hooks.example.com/x" }),
        ),
    ],
    ["PATCH /webhooks", () => webhooks.PATCH(jsonRequest("PATCH", { id: 10 }))],
    [
      "DELETE /webhooks",
      () => webhooks.DELETE(jsonRequest("DELETE", { id: 10 })),
    ],
    [
      "PATCH /webhooks/[id]",
      () =>
        webhook.PATCH(
          jsonRequest("PATCH", { active: false }, "/10"),
          params("10"),
        ),
    ],
    [
      "GET /webhooks/[id]/deliveries",
      () =>
        deliveries.GET(
          new NextRequest("http://localhost/api/v3/webhooks/10/deliveries"),
          params("10"),
        ),
    ],
    [
      "POST /webhooks/[id]/rotate-secret",
      () =>
        rotate.POST(
          new NextRequest("http://localhost/api/v3/webhooks/10/rotate-secret", {
            method: "POST",
          }),
          params("10"),
        ),
    ],
  ];
  for (const [label, call] of calls) {
    it(`${label} answers a JSON 500`, async () => {
      mockGetSession.mockRejectedValue(new Error("session store down"));
      const res = await call();
      expect(res.status).toBe(500);
      expect((await res.json()).error).toEqual(expect.any(String));
    });
  }
});
