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

/**
 * Per-test setting overrides, consulted ahead of the shipped registry
 * default. Lets a test shrink SCAN_ASYNC_CHECKS_TIMEOUT_MS to a few
 * milliseconds and exercise the async layer's real ceiling instead of
 * waiting the shipped 15 seconds for it.
 */
const settingOverrides: Record<string, unknown> = {};

// Runtime-config resolves settings via pool.query under the hood in
// production; mocked here at the module boundary so it does not consume the
// mockQuery call sequence the "never writes scan_history" assertions below
// depend on. The shipped registry default (true) keeps SCAN_AUTH_ENABLED
// identical to the old static SCAN_AUTH.ENABLED constant.
vi.mock("@/lib/config/runtime-config", async () => {
  const { SETTINGS_REGISTRY } = await import("@/lib/config/registry");
  const resolve = (key: keyof typeof SETTINGS_REGISTRY) =>
    key in settingOverrides
      ? settingOverrides[key]
      : SETTINGS_REGISTRY[key].default;
  return {
    getSetting: vi.fn(async (key: keyof typeof SETTINGS_REGISTRY) =>
      resolve(key),
    ),
    getSettings: vi.fn(async (keys: (keyof typeof SETTINGS_REGISTRY)[]) =>
      Object.fromEntries(keys.map((k) => [k, resolve(k)])),
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
  // Read-only gate; the charge happens after the auth session is established.
  canMakeRequest: vi.fn(async () => ({
    allowed: true,
    limit: 100,
    used: 1,
    resetsAt: new Date().toISOString(),
  })),
  incrementDailyCountCapped: vi.fn(async () => ({ recorded: true, count: 1 })),
  getRateLimitHeaders: () => ({}),
}));

// The route now takes a concurrency slot for the scanning half of the request
// (lib/rate-limiting/concurrent-scans.ts's withInlineScanSlot), because an
// authenticated scan runs inline and only writes its already-'completed'
// scan_history row at the end, so the row-count limiter never saw it running.
// Mocked as a pass-through by default; `mockInlineSlot` lets a test drive the
// refusal branch.
const mockInlineSlot = vi.fn(
  async (_userId: number, work: () => Promise<unknown>) => ({
    ok: true as const,
    value: await work(),
  }),
);
vi.mock("@/lib/rate-limiting/concurrent-scans", () => ({
  withInlineScanSlot: (userId: number, work: () => Promise<unknown>) =>
    mockInlineSlot(userId, work),
}));

// Module-scope handles, not inline always-allow factories: a stub declared
// inside the factory cannot be driven to refuse from a test, so the SSRF
// guard and the access-rule blocklist could both be deleted from this route
// with the suite still green. See the matching block in
// tests/app/api/v3/scan/route.test.ts.
const mockValidateScanTarget = vi.fn();
const mockCheckAccessRules = vi.fn();
vi.mock("@/lib/scanner/safe-fetch", () => ({
  validateScanTarget: (...args: unknown[]) => mockValidateScanTarget(...args),
  safeFetch: vi.fn(
    async () => new Response("<html>ok</html>", { status: 200 }),
  ),
}));

vi.mock("@/lib/scanner/access-rules", () => ({
  checkAccessRules: (...args: unknown[]) => mockCheckAccessRules(...args),
}));

const mockIsUrlOwnedByUser = vi.fn();
vi.mock("@/lib/domains/scope", () => ({
  isUrlOwnedByUser: (...args: unknown[]) => mockIsUrlOwnedByUser(...args),
}));

vi.mock("@/lib/scanner/registry", () => ({
  allChecks: [],
  getChecksByCategory: () => [],
}));

// runAsyncChecksDetailed, not runAsyncChecks: this route needs the
// `incomplete` bookkeeping so a run that came back short cannot be presented
// as a clean one. Module-scope handles so a test can drive the timed-out and
// throwing branches, which is the whole property under test below.
const mockRunAsyncChecksDetailed = vi.fn();
const mockGetPlannedAsyncBranches = vi.fn();
vi.mock("@/lib/scanner/async-checks", () => ({
  runAsyncChecksDetailed: (...args: unknown[]) =>
    mockRunAsyncChecksDetailed(...args),
  getPlannedAsyncBranches: (...args: unknown[]) =>
    mockGetPlannedAsyncBranches(...args),
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
  mockValidateScanTarget.mockReset();
  mockValidateScanTarget.mockResolvedValue({ safe: true });
  mockCheckAccessRules.mockReset();
  mockCheckAccessRules.mockResolvedValue({ allowed: true });
  mockRunAsyncChecksDetailed.mockReset();
  mockRunAsyncChecksDetailed.mockResolvedValue({
    findings: [],
    incomplete: [],
  });
  mockGetPlannedAsyncBranches.mockReset();
  mockGetPlannedAsyncBranches.mockReturnValue(["dns", "tls", "live-fetch"]);
  for (const key of Object.keys(settingOverrides)) delete settingOverrides[key];
  mockInlineSlot.mockReset();
  mockInlineSlot.mockImplementation(
    async (_userId: number, work: () => Promise<unknown>) => ({
      ok: true as const,
      value: await work(),
    }),
  );
});

describe("POST /api/v3/scan/authenticated - concurrency slot", () => {
  it("returns 429 and never attempts a login when the account is at its concurrent-scan cap", async () => {
    mockInlineSlot.mockResolvedValue({
      ok: false,
      check: {
        allowed: false,
        current: 1,
        limit: 1,
        message: "You already have 1 scan(s) running.",
      },
    } as never);

    const res = await POST(postRequest(FORM_AUTH_BODY));

    expect(res.status).toBe(429);
    expect((await res.json()).statusCode).toBe("CONCURRENT_SCAN_LIMIT");
    expect(mockEstablishScanSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/v3/scan/authenticated - target safety gates", () => {
  // This route is the one where a refusal matters most: past these two
  // checks it submits caller-supplied credentials to the target's own login
  // form. Both gates therefore have to run BEFORE establishScanSession, and
  // that ordering is what these assert.
  it("returns 400 and never attempts a login when the target is unsafe", async () => {
    mockValidateScanTarget.mockResolvedValue({
      safe: false,
      reason: "Target resolves to a private IP address",
    });

    const res = await POST(postRequest(FORM_AUTH_BODY));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/private IP address/);
    expect(mockEstablishScanSession).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 403 and never attempts a login when access rules refuse", async () => {
    mockCheckAccessRules.mockResolvedValue({ allowed: false });

    const res = await POST(postRequest(FORM_AUTH_BODY));

    expect(res.status).toBe(403);
    expect(mockEstablishScanSession).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("consults both gates with the target URL on the happy path", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: false,
      reason: "stop here; the gates have already run",
    });

    await POST(postRequest(FORM_AUTH_BODY));

    expect(mockValidateScanTarget).toHaveBeenCalledWith(FORM_AUTH_BODY.url);
    expect(mockCheckAccessRules).toHaveBeenCalledWith(FORM_AUTH_BODY.url);
  });
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
    // requestedIsPublic is $10 in the VALUES list, so index 9. Indexed from
    // the front rather than the end: team_id was appended after it, and an
    // .at(-2) assertion silently started reading result_meta instead.
    expect(insertCall[1][9]).toBe(false);

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
    expect(insertCall[1][9]).toBe(false);

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
    expect(insertCall[1][9]).toBe(true);

    const reputationCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO host_reputation"),
    );
    expect(reputationCalls).toHaveLength(1);
  });

  // scan_history.team_id used to be written by nothing at all, so a team
  // could never see a scan a member ran for it. It is now bound on every
  // scan-creation path, but only when the request explicitly names a team.
  it("stores team_id null when the request names no team, and does not look up team membership", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 128 }] });

    await POST(postRequest(FORM_AUTH_BODY));

    const insertCall = mockQuery.mock.calls[0];
    expect(insertCall[0]).toContain("team_id");
    expect(insertCall[1].at(-1)).toBeNull();
    const membershipCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("FROM team_members"),
    );
    expect(membershipCalls).toHaveLength(0);
  });

  it("stores the requested team_id when the caller can assign scans to that team", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    // getAssignableTeamIds, then the scan_history INSERT.
    mockQuery.mockResolvedValueOnce({ rows: [{ team_id: 7, role: "admin" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 129 }] });

    const res = await POST(postRequest({ ...FORM_AUTH_BODY, teamId: 7 }));
    expect(res.status).toBe(200);

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCall![1].at(-1)).toBe(7);
  });

  it("rejects a team the caller cannot assign scans to, and writes no scan row", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ team_id: 3, role: "viewer" }] });

    const res = await POST(postRequest({ ...FORM_AUTH_BODY, teamId: 3 }));
    expect(res.status).toBe(400);
    const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO scan_history"),
    );
    expect(insertCalls).toHaveLength(0);
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

describe("domain ownership gate", () => {
  // A form login POSTs the caller's username and password to the target's
  // own login page and reports back distinguishably whether they were
  // accepted, so it is now held to the same verified-domain gate as active
  // probing: without it the endpoint is a credential-stuffing proxy with a
  // built-in success oracle, running from this server's IP.
  it("requires a verified domain for a form login even with no active probes requested", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    await POST(postRequest(FORM_AUTH_BODY));
    expect(mockIsUrlOwnedByUser).toHaveBeenCalledWith(
      "https://app.example.com/dashboard",
      42,
    );
  });

  it("rejects a form login against an unverified domain before ever attempting it", async () => {
    mockIsUrlOwnedByUser.mockResolvedValue(false);
    const res = await POST(postRequest(FORM_AUTH_BODY));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.statusCode).toBe("DOMAIN_NOT_VERIFIED");
    expect(json.error).toMatch(/form login/i);
    expect(mockEstablishScanSession).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // Header and cookie auth are the caller supplying a session they already
  // hold, not credentials being validated against a login form, so they stay
  // ungated.
  it("never checks domain ownership for a cookie-auth scan with no active probes", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await POST(
      postRequest({
        url: "https://app.example.com/dashboard",
        auth: {
          method: "cookie",
          cookies: [{ name: "sessionid", value: "already-mine" }],
        },
      }),
    );
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

/**
 * "We found nothing" and "we could not finish looking" must never be the same
 * output. This route used to make them identical: it called the
 * bookkeeping-free `runAsyncChecks`, which throws the `incomplete` list away,
 * and its own outer ceiling resolved to a bare `[]`. So an authenticated scan
 * whose DNS, TLS and live-fetch branches all ran out of time answered with
 * summary.total = 0 and nothing marking it short, and the dashboard drew it as
 * "Zero findings on this host. Every enabled check ran and none of them fired."
 *
 * The single property every test here asserts is the one the UI actually
 * branches on (components/scanner/scan-summary.tsx, scan-result-detail.tsx,
 * dashboard-results.tsx): a result reads as clean only when it has no findings
 * AND no `incomplete` entries. `presentsAsClean` below is that predicate,
 * written out once so each case states the same thing.
 */
function presentsAsClean(json: {
  summary?: { total?: number };
  incomplete?: string[];
}): boolean {
  return (
    (json.summary?.total ?? 0) === 0 && (json.incomplete ?? []).length === 0
  );
}

/** The result_meta JSON bound into the scan_history INSERT (11th param). */
function persistedResultMeta(calls: unknown[][]): Record<string, unknown> {
  const insert = calls.find((call) =>
    String(call[0]).includes("INSERT INTO scan_history"),
  );
  return JSON.parse(String((insert![1] as unknown[])[10]));
}

describe("POST /api/v3/scan/authenticated - an unfinished scan cannot present as clean", () => {
  it("names the branches that did not finish, and does not read as clean, when the async layer comes back short", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: ["dns", "tls"],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 900 }] });

    const res = await POST(postRequest(FORM_AUTH_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.summary.total).toBe(0);
    expect(json.incomplete).toEqual(["dns", "tls"]);
    expect(presentsAsClean(json)).toBe(false);
    // And the same on every later read of this scan: History, the shared
    // link and the public host page all render from result_meta, not from
    // this response.
    expect(persistedResultMeta(mockQuery.mock.calls).incomplete).toEqual([
      "dns",
      "tls",
    ]);
  });

  it("marks every planned branch unfinished when the whole async layer hits this route's ceiling", async () => {
    settingOverrides.SCAN_ASYNC_CHECKS_TIMEOUT_MS = 5;
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    // Still running when the ceiling fires: the exact case that used to
    // resolve to a bare [] and report the scan as complete.
    mockRunAsyncChecksDetailed.mockReturnValue(
      new Promise((resolve) =>
        setTimeout(() => resolve({ findings: [], incomplete: [] }), 300),
      ),
    );
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 901 }] });

    const res = await POST(postRequest(FORM_AUTH_BODY));
    const json = await res.json();

    expect(json.incomplete).toEqual(["dns", "tls", "live-fetch"]);
    expect(presentsAsClean(json)).toBe(false);
  });

  it("marks every planned branch unfinished when the async layer throws outright", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockRunAsyncChecksDetailed.mockRejectedValue(new Error("resolver blew up"));
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 902 }] });

    const res = await POST(postRequest(FORM_AUTH_BODY));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.incomplete).toEqual(["dns", "tls", "live-fetch"]);
    expect(presentsAsClean(json)).toBe(false);
  });

  it("does not read as clean when the login held but the session was lost mid-scan", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: {
        lost: true,
        reason: "The target cleared the session cookie during the scan.",
      },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 903 }] });

    const res = await POST(postRequest(FORM_AUTH_BODY));
    const json = await res.json();

    // The pages that came back are the signed-out surface, so the
    // authenticated area the caller asked about was never checked.
    expect(json.authReport.status).toBe("lost");
    expect(json.incomplete).toContain("authenticated-session");
    expect(presentsAsClean(json)).toBe(false);
    expect(persistedResultMeta(mockQuery.mock.calls).incomplete).toContain(
      "authenticated-session",
    );
  });

  it("still reads as clean, with no incomplete marker at all, when everything genuinely ran", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 904 }] });

    const res = await POST(postRequest(FORM_AUTH_BODY));
    const json = await res.json();

    expect(json.summary.total).toBe(0);
    // Absent, not an empty array: a consumer that only checks for the key
    // must be able to tell "everything ran" from "something did not".
    expect(json.incomplete).toBeUndefined();
    expect(presentsAsClean(json)).toBe(true);
    expect(
      persistedResultMeta(mockQuery.mock.calls).incomplete,
    ).toBeUndefined();
  });

  it("reports lower engine confidence for a run that came back short than for one that finished", async () => {
    mockEstablishScanSession.mockResolvedValue({
      ok: true,
      session: { lost: false, reason: null },
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 905 }] });
    const complete = await (await POST(postRequest(FORM_AUTH_BODY))).json();

    mockRunAsyncChecksDetailed.mockResolvedValue({
      findings: [],
      incomplete: ["dns"],
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 906 }] });
    const short = await (await POST(postRequest(FORM_AUTH_BODY))).json();

    expect(short.engineConfidence).toBeLessThan(complete.engineConfidence);
  });
});
