import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Route-level tests for GET /api/v3/notifications/active, the endpoint
 * SiteNotificationsWrapper (components/shared/site-notifications.tsx) and
 * NotificationBell (components/shared/notification-center.tsx) both poll to
 * decide which admin-authored banner/modal/toast/bell notifications to show.
 *
 * Audience privilege is derived from the SERVER session, never from client
 * query params. The route used to bind `?authenticated=true&staff=true`
 * straight into the SQL audience gate, letting any caller self-elevate to
 * receive staff/admin-only broadcasts; these tests pin that the params are
 * ignored.
 *
 * "Staff Only" and "Admins Only" are different audiences in the admin panel,
 * so `isAdmin` is its own flag. Both flags now come from requireStaff() and
 * requireAdmin(), which read the role from the users row and apply
 * ENFORCE_STAFF_2FA. They used to come from the session's role string alone,
 * so a staff account the 2FA policy had shut out of every staff route still
 * received the notices written for staff and admins.
 *
 * lib/auth/authorization runs for real. Only the session, the settings
 * resolver and the database are faked, and the fake database answers the
 * notifications query by applying the route's own audience placeholders to a
 * fixture list, so "is it returned" is asserted on the response body.
 */

interface Account {
  role: string;
  totp_enabled: boolean;
}

const accounts = new Map<number, Account>();
const AUDIENCES = [
  "all",
  "authenticated",
  "unauthenticated",
  "staff",
  "admin",
] as const;
type Audience = (typeof AUDIENCES)[number];
const FIXTURES = AUDIENCES.map((audience, i) => ({
  id: i + 1,
  title: `${audience} notice`,
  audience,
}));

function visibleFor(params: unknown[]) {
  const [, authed, staff, admin] = params as [Date, boolean, boolean, boolean];
  const shown: Record<Audience, boolean> = {
    all: true,
    authenticated: authed,
    unauthenticated: !authed,
    staff,
    admin,
  };
  return FIXTURES.filter((n) => shown[n.audience]);
}

const mockQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  if (/FROM users WHERE id = \$1/.test(sql)) {
    const account = accounts.get(params[0] as number);
    return { rows: account ? [{ id: params[0], ...account }] : [] };
  }
  if (sql.includes("FROM admin_notifications")) {
    return { rows: visibleFor(params) };
  }
  throw new Error(`unexpected query: ${sql}`);
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

let enforceStaff2fa = false;
vi.mock("@/lib/config/runtime-config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/config/runtime-config")>();
  return {
    ...actual,
    getSetting: async (key: string) =>
      key === "ENFORCE_STAFF_2FA" ? enforceStaff2fa : actual.getSetting(key),
  };
});

const { GET } = await import("@/app/api/v3/notifications/active/route");
const { currentRequestId } = await import("@/lib/database/request-context");

/** Sign in as a fresh account with this role. */
function signIn(role: string, totp = true, sessionRole = role) {
  const id = accounts.size + 100;
  accounts.set(id, { role, totp_enabled: totp });
  mockGetSession.mockResolvedValue({ userId: id, role: sessionRole });
}

async function audiencesShown(): Promise<string[]> {
  const res = await GET();
  expect(res.status).toBe(200);
  const json = (await res.json()) as {
    notifications: Array<{ audience: string }>;
  };
  return json.notifications.map((n) => n.audience).sort();
}

function notificationParams(): unknown[] {
  const call = mockQuery.mock.calls.find(([sql]) =>
    sql.includes("FROM admin_notifications"),
  );
  expect(call).toBeDefined();
  return call![1] as unknown[];
}

beforeEach(() => {
  mockQuery.mockClear();
  mockGetSession.mockReset();
  accounts.clear();
  enforceStaff2fa = false;
});

describe("GET /api/v3/notifications/active", () => {
  it("treats a request with no session as an unauthenticated guest", async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await audiencesShown()).toEqual(["all", "unauthenticated"]);
    const params = notificationParams();
    expect(params[1]).toBe(false);
    expect(params[2]).toBe(false);
    expect(params[3]).toBe(false);
  });

  it("marks a signed-in non-staff user authenticated but not staff", async () => {
    signIn("user");
    expect(await audiencesShown()).toEqual(["all", "authenticated"]);
  });

  it("reads the role from the account, not from the session", async () => {
    // A session minted before a demotion can still name the old role.
    signIn("user", true, "super_admin");
    const params = (await GET(), notificationParams());
    expect(params[2]).toBe(false);
    expect(params[3]).toBe(false);
  });

  it("gives nothing to a session whose account no longer exists", async () => {
    mockGetSession.mockResolvedValue({ userId: 999, role: "admin" });
    expect(await audiencesShown()).toEqual(["all", "authenticated"]);
  });

  describe("the admin audience", () => {
    const BELOW_ADMIN = [
      "support",
      "billing",
      "security_analyst",
      "content_manager",
      "ops",
      "moderator",
    ];

    it.each(BELOW_ADMIN)(
      "shows %s the staff notice but not the admin one",
      async (role) => {
        signIn(role);
        expect(await audiencesShown()).toEqual([
          "all",
          "authenticated",
          "staff",
        ]);
      },
    );

    it.each(["admin", "super_admin"])(
      "shows %s both the staff and the admin notice",
      async (role) => {
        signIn(role);
        expect(await audiencesShown()).toEqual([
          "admin",
          "all",
          "authenticated",
          "staff",
        ]);
      },
    );

    it("does not trust a role string it does not know", async () => {
      signIn("root");
      expect(await audiencesShown()).toEqual(["all", "authenticated"]);
    });

    it("gates 'staff' on the staff flag and 'admin' on the admin flag", async () => {
      mockGetSession.mockResolvedValue(null);
      await GET();
      const call = mockQuery.mock.calls.find(([sql]) =>
        sql.includes("FROM admin_notifications"),
      );
      const sql = String(call?.[0]);
      expect(sql).toContain("audience = 'staff' AND $3");
      expect(sql).toContain("audience = 'admin' AND $4");
      expect(sql).not.toContain("audience = 'admin' AND $3");
    });
  });

  describe("under ENFORCE_STAFF_2FA", () => {
    it("does not show an admin without 2FA the admin notice", async () => {
      enforceStaff2fa = true;
      signIn("admin", false);
      const shown = await audiencesShown();
      expect(shown).not.toContain("admin");
      expect(shown).not.toContain("staff");
      expect(shown).toEqual(["all", "authenticated"]);
    });

    it.each(["support", "moderator", "super_admin"])(
      "does not show %s without 2FA the staff notice",
      async (role) => {
        enforceStaff2fa = true;
        signIn(role, false);
        expect(await audiencesShown()).toEqual(["all", "authenticated"]);
      },
    );

    it("still shows an admin with 2FA on both notices", async () => {
      enforceStaff2fa = true;
      signIn("admin", true);
      expect(await audiencesShown()).toEqual([
        "admin",
        "all",
        "authenticated",
        "staff",
      ]);
    });

    it("leaves an admin without 2FA alone when the policy is off", async () => {
      signIn("admin", false);
      expect(await audiencesShown()).toContain("admin");
    });
  });

  it("returns the rows from the query under a notifications key", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(Array.isArray(json.notifications)).toBe(true);
    expect(json.notifications).toHaveLength(2);
  });

  it("returns 500 and does not throw when the database errors", async () => {
    mockGetSession.mockResolvedValue(null);
    mockQuery.mockRejectedValueOnce(new Error("connection lost"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await GET();
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
  });

  it("runs inside a request context so its log rows carry a request id", async () => {
    mockGetSession.mockResolvedValue(null);
    let seen: string | null = null;
    mockQuery.mockImplementationOnce(async () => {
      seen = currentRequestId();
      return { rows: [] };
    });
    await GET();
    expect(seen).toEqual(expect.any(String));
  });

  it("logs a database failure with the Error itself, so the stack is kept", async () => {
    mockGetSession.mockResolvedValue(null);
    const failure = new Error("connection lost");
    mockQuery.mockRejectedValueOnce(failure);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await GET();
      const call = spy.mock.calls.find((args) =>
        String(args[0]).startsWith("[notifications]"),
      );
      expect(call).toBeDefined();
      expect(call).toContain(failure);
    } finally {
      spy.mockRestore();
    }
  });
});
