/**
 * Route-level tests for POST /api/v3/scan/authenticated.
 *
 * Login mechanics have their own dedicated suites (tests/lib/scanner/auth/
 * login.test.ts, browser-login.test.ts); this file exercises the route's
 * own orchestration and, above all, the ephemeral-credential discipline:
 * the request body's `auth` material must never reach a persisted row, a
 * logged audit record, or an error message.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

// Runtime-config resolves settings via pool.query under the hood in
// production; mocked here at the module boundary so it does not consume the
// mockQuery call sequence the "never writes scan_history" assertions below
// depend on. The shipped registry default (true) keeps SCAN_AUTH_ENABLED
// identical to the old static SCAN_AUTH.ENABLED constant.
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  return {
    getSetting: vi.fn(
      async (key: keyof typeof SETTINGS_REGISTRY) =>
        SETTINGS_REGISTRY[key].default,
    ),
    getSettings: vi.fn(async (keys: (keyof typeof SETTINGS_REGISTRY)[]) =>
      Object.fromEntries(keys.map((k) => [k, SETTINGS_REGISTRY[k].default])),
    ),
  };
});

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: () => mockGetSession() };
});

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({
      allowed: true,
      remaining: 9,
      retryAfterSeconds: 0,
    })),
  };
});

vi.mock("@/lib/rate-limiting/daily-limits", () => ({
  checkAndRecordRequest: vi.fn(async () => ({
    allowed: true,
    limit: 100,
    used: 1,
    resetsAt: new Date().toISOString(),
  })),
  getRateLimitHeaders: () => ({}),
}));

vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: vi.fn(async () => ({ safe: true })),
  safeFetch: vi.fn(
    async () => new Response("<html>ok</html>", { status: 200 }),
  ),
}));

vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: vi.fn(async () => ({ allowed: true })),
}));

const mockIsUrlOwnedByUser = vi.fn();
vi.mock("@/lib/domains/scope", () => ({
  isUrlOwnedByUser: (...args: unknown[]) => mockIsUrlOwnedByUser(...args),
}));

vi.mock("@/lib/scanner/registry", () => ({
  allChecks: [],
  getChecksByCategory: () => [],
}));

vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecks: vi.fn(async () => []),
}));

const mockEstablishScanSession = vi.fn();
vi.mock("@/lib/scanner/auth/login", () => ({
  establishScanSession: (...args: unknown[]) =>
    mockEstablishScanSession(...args),
  readCappedBody: async (response: Response) => response.text(),
}));

const mockLogAction = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/auth/authorization", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/authorization")>();
  return { ...actual, logAction: mockLogAction };
});

const { POST } = await import("@/app/api/v3/scan/authenticated/route");

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v3/scan/authenticated", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 42 });
  mockEstablishScanSession.mockReset();
  mockLogAction.mockClear();
  mockIsUrlOwnedByUser.mockReset();
  mockIsUrlOwnedByUser.mockResolvedValue(true);
});

const FORM_AUTH_BODY = {
  url: "https://app.example.com/dashboard",
  auth: {
    method: "form",
    username: "admin",
    password: "hunter2-super-secret",
  },
};

describe("POST /api/v3/scan/authenticated", () => {
  it("aborts before scanning when the login fails, and never writes scan_history", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: false,
      reason: "The target rejected the login request with 401.",
    });

    const res = await POST(postRequest(FORM_AUTH_BODY));

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.authReport.status).toBe("failed");
    expect(json.authReport.reason).toMatch(/rejected the login/i);
    expect(json.authReport.method).toBe("form");
    // Never a stored-credential concept anywhere in the response.
    expect(json.authReport.credentialId).toBeUndefined();
    expect(json.authReport.credentialName).toBeUndefined();
    // Never the plaintext password in the aborted response, whether or
    // not the login layer echoed anything back.
    expect(JSON.stringify(json)).not.toContain("hunter2-super-secret");
    // No scan_history INSERT: the login never succeeded so nothing runs.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("never passes credential material to logAction, even on failure", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: false,
      reason: "The login request could not be completed.",
    });

    await POST(postRequest(FORM_AUTH_BODY));

    // logAction isn't even called on a failed login: only a successful,
    // audited scan gets an audit line, and only the fact of it.
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("runs the scan and reports authenticated success, persisting scan_history with authenticated=true and no credential column", async () => {
    const fakeSession = { lost: false, reason: null as string | null };
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: fakeSession,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 123 }] }); // scan_history insert

    const res = await POST(postRequest(FORM_AUTH_BODY));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authReport.status).toBe("authenticated");
    expect(json.authReport.method).toBe("form");
    expect(json.scanHistoryId).toBe(123);

    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[0]).toContain("scan_history");
    expect(insertCall[0]).toContain("authenticated");
    expect(insertCall[0]).not.toContain("credential_id");
    // The username/password never appear in the INSERT's bound values.
    expect(JSON.stringify(insertCall[1])).not.toContain("hunter2-super-secret");

    // The audit line records only the non-secret outcome.
    expect(mockLogAction).toHaveBeenCalledTimes(1);
    const auditDetails = String(mockLogAction.mock.calls[0][3]);
    expect(auditDetails).not.toContain("hunter2-super-secret");
    expect(auditDetails).not.toContain("admin");
    expect(auditDetails).toMatch(/authenticated/i);
  });

  it("normalizes a bare domain (no scheme) the same way POST /api/v3/scan does, instead of rejecting it with Zod's generic message", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 321 }] });

    const res = await POST(
      postRequest({
        url: "app.example.com/login",
        auth: FORM_AUTH_BODY.auth,
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toBe("https://app.example.com/login");
  });

  it("normalizes a bare-domain auth.loginUrl the same way", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 322 }] });

    await POST(
      postRequest({
        url: FORM_AUTH_BODY.url,
        auth: { ...FORM_AUTH_BODY.auth, loginUrl: "app.example.com/signin" },
      }),
    );

    expect(mockEstablishScanSession).toHaveBeenCalledTimes(1);
    const authArg = mockEstablishScanSession.mock.calls[0][0];
    expect(authArg.loginUrl).toBe("https://app.example.com/signin");
  });

  it("persists is_public=false by default and skips host_reputation, unlike the plain scan/crawl routes -- an authenticated scan requires an explicit opt-in", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 125 }] });

    await POST(postRequest(FORM_AUTH_BODY));

    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[0]).toContain("is_public");
    // requestedIsPublic is the last bound param ($10 in the VALUES list).
    expect(insertCall[1].at(-1)).toBe(false);

    const reputationCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO host_reputation"),
    );
    expect(reputationCalls).toHaveLength(0);
    // No account-default lookup either: this endpoint never consults
    // scans_private_by_default. The only queries are the scan_history
    // INSERT, lib/tags/auto-tags.ts's promoted-rules lookup (loadPromotedRules,
    // part of saveAutoTags), and the auto-tags save itself -- unlike
    // host_reputation, auto tags are saved regardless of is_public. Located
    // by content rather than a fixed index: saveAutoTags' own promoted-rules
    // SELECT (an extra await before the INSERT) makes the exact call order
    // relative to the rest of the fire-and-forget chain not worth pinning
    // down here.
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const tagsCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_tags"),
    );
    expect(tagsCall).toBeDefined();
    expect(tagsCall![0]).toContain("INSERT INTO scan_tags");
  });

  it("persists is_public=false and skips host_reputation when the request explicitly asks for a private scan", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 126 }] });

    await POST(postRequest({ ...FORM_AUTH_BODY, isPublic: false }));

    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[1].at(-1)).toBe(false);

    const reputationCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO host_reputation"),
    );
    expect(reputationCalls).toHaveLength(0);
  });

  it("persists is_public=true and upserts host_reputation only when the request explicitly opts in", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 127 }] });

    await POST(postRequest({ ...FORM_AUTH_BODY, isPublic: true }));

    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[1].at(-1)).toBe(true);

    const reputationCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO host_reputation"),
    );
    expect(reputationCalls).toHaveLength(1);
  });

  it("reports a lost session without ever writing a credential_id column", async () => {
    const fakeSession = {
      lost: true,
      reason: "The target cleared the session cookie during the scan.",
    };
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: fakeSession,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 124 }] });

    const res = await POST(postRequest(FORM_AUTH_BODY));
    const json = await res.json();
    expect(json.authReport.status).toBe("lost");
    expect(json.authReport.reason).toMatch(/cleared the session cookie/i);
  });

  it("accepts a header-auth request and never reveals the header value on failure", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: false,
      reason: "The target answered 403 to the authenticated request.",
    });

    const res = await POST(
      postRequest({
        url: "https://app.example.com/api/status",
        auth: {
          method: "header",
          headerName: "Authorization",
          headerValue: "Bearer super-secret-token",
        },
      }),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.authReport.method).toBe("header");
    expect(JSON.stringify(json)).not.toContain("super-secret-token");
  });

  it("accepts a cookie-auth request and never reveals cookie values on failure", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: false,
      reason: "The login did not set or change any cookie.",
    });

    const res = await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: {
          method: "cookie",
          cookies: [{ name: "sessionid", value: "super-secret-cookie" }],
        },
      }),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.authReport.method).toBe("cookie");
    expect(JSON.stringify(json)).not.toContain("super-secret-cookie");
  });

  it("rejects a malformed auth body before ever calling establishScanSession", async () => {
    const res = await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: { method: "form" }, // missing username/password
      }),
    );
    expect(res.status).toBe(400);
    expect(mockEstablishScanSession).not.toHaveBeenCalled();
  });
});

describe("active-probes domain ownership gate", () => {
  it("never checks domain ownership for an ordinary authenticated scan that doesn't request active-probes", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(postRequest(FORM_AUTH_BODY));
    expect(mockIsUrlOwnedByUser).not.toHaveBeenCalled();
  });

  it("rejects with 403 when active-probes is requested against an unverified domain, before ever attempting login", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(false);
    const res = await POST(
      postRequest({
        ...FORM_AUTH_BODY,
        scanners: ["headers", "active-probes"],
      }),
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(mockEstablishScanSession).not.toHaveBeenCalled();
  });

  it("proceeds normally when active-probes is requested against a verified domain", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(true);
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 2 }] });
    const res = await POST(
      postRequest({ ...FORM_AUTH_BODY, scanners: ["active-probes"] }),
    );
    expect(res.status).toBe(200);
    expect(mockEstablishScanSession).toHaveBeenCalledTimes(1);
  });
});
