/**
 * POST /api/v3/admin/queue-status/cancel: stopping one scan from the admin
 * queue.
 *
 * The scan-jobs module is the real one here, over a faked pool, because the
 * interesting property is an ordering: the row has to be closed (as
 * admin_cancelled) BEFORE the in-process job is told to stop, or the job's own
 * catch races the write with a cancel of its own and staff's cancel gets
 * recorded as the owner's. Auth is mocked at the getSession/db boundary, the
 * same approach the sibling queue-status suite uses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: async () => "127.0.0.1",
}));

const { POST } = await import("@/app/api/v3/admin/queue-status/cancel/route");
const { isCancelled, clearCancel } = await import("@/lib/scanner/scan-jobs");

function post(body: unknown, raw = false) {
  return new Request(
    "https://vulnradar.test/api/v3/admin/queue-status/cancel",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    },
  );
}

/** What the failure write reads back off the row it closed. */
const CLOSED_ROW = {
  id: 77,
  user_id: 42,
  source: "api",
  categories_completed: 3,
  categories_total: 9,
  timed_out_in: null,
};

interface Recorded {
  /** Whether the in-process cancel flag was already set when the row was written. */
  flagWhenRowWritten: boolean | null;
}

function installQueries(
  opts: {
    role?: string;
    updateRows?: unknown[];
    auditFails?: boolean;
  } = {},
): Recorded {
  const recorded: Recorded = { flagWhenRowWritten: null };
  mockGetSession.mockResolvedValue({ userId: 7 });
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM users")) {
      // totp_enabled short-circuits requireAdmin's 2FA-enforcement lookup.
      return {
        rows: [{ id: 7, role: opts.role ?? "admin", totp_enabled: true }],
      };
    }
    if (sql.includes("UPDATE scan_history")) {
      recorded.flagWhenRowWritten = isCancelled(77);
      const rows = opts.updateRows ?? [CLOSED_ROW];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("admin_audit_log")) {
      if (opts.auditFails) throw new Error("audit table gone");
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return recorded;
}

function updateCall() {
  return mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes("UPDATE scan_history"),
  );
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
  clearCancel(77);
});

afterEach(() => {
  clearCancel(77);
});

describe("POST /api/v3/admin/queue-status/cancel: who may", () => {
  it("requires a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(post({ scanId: 77 }));
    expect(res.status).toBe(403);
    expect(updateCall()).toBeUndefined();
  });

  it.each(["support", "moderator", "ops"])(
    "refuses %s: it ends another person's scan, so it is admin only",
    async (role) => {
      installQueries({ role });
      const res = await POST(post({ scanId: 77 }));
      expect(res.status).toBe(403);
      expect(updateCall()).toBeUndefined();
      expect(isCancelled(77)).toBe(false);
    },
  );
});

describe("POST /api/v3/admin/queue-status/cancel: the request", () => {
  it.each([
    ["no body", "", true],
    ["not JSON", "{nope", true],
    ["a missing scanId", {}, false],
    ["a null scanId", { scanId: null }, false],
    ["a zero scanId", { scanId: 0 }, false],
    ["a negative scanId", { scanId: -4 }, false],
    ["a fractional scanId", { scanId: 1.5 }, false],
    ["a scanId past int4", { scanId: 2_147_483_648 }, false],
    ["an array scanId", { scanId: [77] }, false],
    ["a non-numeric string", { scanId: "77; DROP TABLE" }, false],
  ] as const)(
    "answers 400 for %s and writes nothing",
    async (_name, body, raw) => {
      installQueries();
      const res = await POST(post(body, raw));
      expect(res.status).toBe(400);
      expect(updateCall()).toBeUndefined();
    },
  );

  it("accepts the id as a numeric string", async () => {
    installQueries();
    const res = await POST(post({ scanId: "77" }));
    expect(res.status).toBe(200);
    expect(updateCall()?.[1]).toEqual([
      "Cancelled by an administrator.",
      77,
      "admin_cancelled",
    ]);
  });
});

describe("POST /api/v3/admin/queue-status/cancel: cancelling", () => {
  it("closes the row as admin_cancelled and then stops the job", async () => {
    const recorded = installQueries();

    const res = await POST(post({ scanId: 77 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, scanId: 77 });
    const [sql, params] = updateCall()!;
    expect(String(sql)).toContain("status = 'failed'");
    expect(String(sql)).toContain("status IN ('pending', 'running')");
    expect(params).toEqual([
      "Cancelled by an administrator.",
      77,
      "admin_cancelled",
    ]);
    // The point of the ordering: the flag was NOT yet set when the row was
    // written, so the job's own catch cannot have beaten this write with a
    // cancel of its own; it is set once the write has landed.
    expect(recorded.flagWhenRowWritten).toBe(false);
    expect(isCancelled(77)).toBe(true);
  });

  it("answers 409 and leaves no cancel flag behind for a scan that already finished", async () => {
    installQueries({ updateRows: [] });

    const res = await POST(post({ scanId: 77 }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/nothing to cancel/i);
    expect(isCancelled(77)).toBe(false);
    // And no audit row for an action that did not happen.
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        String(sql).includes("admin_audit_log"),
      ),
    ).toBe(false);
  });

  it("writes the admin_cancel_scan audit row against the scan's owner", async () => {
    installQueries();

    await POST(post({ scanId: 77 }));

    const audit = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("admin_audit_log"),
    );
    expect(audit).toBeDefined();
    const params = audit![1] as unknown[];
    // actor, target user, action
    expect(params[0]).toBe(7);
    expect(params[1]).toBe(42);
    expect(params[2]).toBe("admin_cancel_scan");
    expect(String(params[3])).toContain("#77");
    expect(String(params[3])).toContain("api");
  });

  it("keeps the customer's URL out of the audit details", async () => {
    installQueries({
      updateRows: [{ ...CLOSED_ROW, url: "https://customer.example/secret" }],
    });

    await POST(post({ scanId: 77 }));

    const audit = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes("admin_audit_log"),
    );
    expect(String((audit![1] as unknown[])[3])).not.toContain("customer");
  });

  it("still reports the cancel when the audit write fails, and logs that it did", async () => {
    installQueries({ auditFails: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(post({ scanId: 77 }));

    // The scan is already stopped; failing the response would say it was not.
    expect(res.status).toBe(200);
    expect(isCancelled(77)).toBe(true);
    expect(
      (errSpy.mock.calls as unknown[][]).some(([message]) =>
        String(message).includes("admin_cancel_scan"),
      ),
    ).toBe(true);
    errSpy.mockRestore();
  });
});
