/**
 * edit_note and delete_note on PATCH /api/v3/admin.
 *
 * Both used to load and change a note by its id alone. The rank rule and the
 * god-mode guard run against the `userId` in the body, so an admin could name
 * any harmless account as the target and any note id as the object: a note an
 * admin peer wrote about a third person, or a note the super admin wrote about
 * the caller, was rewritten or deleted with the audit row naming the harmless
 * account. These run the real route against a small in-memory notes table, so
 * "the row survives" is a statement about the table, not about which mock was
 * consumed.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

interface NoteRow {
  id: number;
  user_id: number;
  admin_id: number;
  note: string;
}

const users: Record<number, { role: string; email: string }> = {};
let notes: NoteRow[] = [];

function fakeQuery(sql: string, params: unknown[] = []) {
  const text = sql.replace(/\s+/g, " ").trim();
  if (text.startsWith("SELECT role, totp_enabled FROM users")) {
    const u = users[params[0] as number];
    return { rows: u ? [{ role: u.role, totp_enabled: true }] : [] };
  }
  if (text.startsWith("SELECT email, totp_enabled")) {
    const u = users[params[0] as number];
    return {
      rows: u
        ? [
            {
              email: u.email,
              role: u.role,
              plan: "free",
              ai_chat_banned: false,
            },
          ]
        : [],
    };
  }
  if (text.includes("FROM admin_user_notes")) {
    // Honour exactly the predicate the statement names: an id-only lookup
    // matches any note, a scoped one only that account's.
    const scoped = /user_id = \$2/.test(text);
    const match = (n: NoteRow) =>
      n.id === Number(params[0]) && (!scoped || n.user_id === params[1]);
    if (text.startsWith("SELECT")) {
      return { rows: notes.filter(match).map((n) => ({ ...n })) };
    }
  }
  if (text.startsWith("UPDATE admin_user_notes")) {
    // The edit binds the note text first: UPDATE ... SET note = $1 WHERE id = $2 [AND user_id = $3]
    const scoped = /user_id = \$3/.test(text);
    const hit = notes.filter(
      (n) => n.id === Number(params[1]) && (!scoped || n.user_id === params[2]),
    );
    for (const n of hit) n.note = String(params[0]);
    return { rows: hit.map((n) => ({ id: n.id })), rowCount: hit.length };
  }
  if (text.startsWith("DELETE FROM admin_user_notes")) {
    const scoped = /user_id = \$2/.test(text);
    const hit = notes.filter(
      (n) => n.id === Number(params[0]) && (!scoped || n.user_id === params[1]),
    );
    notes = notes.filter((n) => !hit.includes(n));
    return { rows: hit.map((n) => ({ id: n.id })), rowCount: hit.length };
  }
  return { rows: [], rowCount: 0 };
}

const mockQuery = vi.fn(async (sql: string, params?: unknown[]) =>
  fakeQuery(sql, params),
);
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockQuery(sql, params),
    connect: vi.fn(),
  },
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
  hashPassword: async () => "scrypt-stub",
}));

const mockLogAction = vi.fn();
vi.mock("@/lib/auth/authorization", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/authorization")>()),
  logAction: (...args: unknown[]) => mockLogAction(...args),
}));

vi.mock("@/lib/rate-limiting/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limiting/rate-limit")>()),
  checkRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 9,
    retryAfterSeconds: 0,
  })),
}));

vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: vi.fn(async () => 1000),
  getStoredSetting: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api/request-utils", () => ({
  getClientIp: vi.fn(async () => "127.0.0.1"),
  getUserAgent: vi.fn(async () => "vitest"),
  rateLimitIpKey: (ip: string) => ip,
}));

vi.mock("@/lib/email/email", () => ({
  sendEmail: vi.fn(),
  adminNotificationEmail: vi.fn(),
  adminAccountChangeEmail: vi.fn(),
  passwordResetEmail: vi.fn(),
  passwordChangedEmail: vi.fn(),
  twoFactorRecoveryCodeEmail: vi.fn(),
}));

const { PATCH } = await import("@/app/api/v3/admin/route");

// The cast: admin A is the caller, B is a peer admin, C an ordinary account,
// S the super admin.
const A = 2;
const B = 3;
const C = 4;
const S = 7;

beforeEach(() => {
  mockQuery.mockClear();
  mockLogAction.mockReset();
  for (const k of Object.keys(users)) delete users[Number(k)];
  users[A] = { role: "admin", email: "a@example.com" };
  users[B] = { role: "admin", email: "b@example.com" };
  users[C] = { role: "user", email: "c@example.com" };
  users[S] = { role: "super_admin", email: "s@example.com" };
  notes = [
    // About peer admin B, which A may not act on.
    { id: 10, user_id: B, admin_id: S, note: "about B" },
    // About A, written by the super admin.
    { id: 11, user_id: A, admin_id: S, note: "about A, by S" },
    // About A, written by A.
    { id: 12, user_id: A, admin_id: A, note: "about A, by A" },
    // About C, written by B.
    { id: 13, user_id: C, admin_id: B, note: "about C, by B" },
  ];
  mockGetSession.mockResolvedValue({
    userId: A,
    email: "a@example.com",
    name: "A",
    tosAcceptedAt: null,
    role: "overwritten-by-requireStaff",
  });
});

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest("http://localhost/api/v3/admin", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const noteText = (id: number) => notes.find((n) => n.id === id)?.note;

describe("edit_note and delete_note are scoped to the target account", () => {
  it("edit_note: a note on another account is a 404 and the note is unchanged", async () => {
    const res = await patch({
      action: "edit_note",
      userId: C,
      noteId: 10,
      note: "rewritten",
    });
    expect(res.status).toBe(404);
    expect(noteText(10)).toBe("about B");
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("delete_note: a note on another account is a 404 and the row survives", async () => {
    const res = await patch({ action: "delete_note", userId: C, noteId: 10 });
    expect(res.status).toBe(404);
    expect(noteText(10)).toBe("about B");
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("issues every note statement with the target account bound beside the id", async () => {
    await patch({ action: "edit_note", userId: C, noteId: 13, note: "x" });
    await patch({ action: "delete_note", userId: C, noteId: 13 });
    const noteStatements = mockQuery.mock.calls.filter(([sql]) =>
      /admin_user_notes/.test(sql),
    );
    expect(noteStatements.length).toBeGreaterThanOrEqual(4);
    for (const [sql, params] of noteStatements) {
      expect(sql).toMatch(/user_id = \$\d/);
      expect(params).toContain(C);
    }
  });

  it("still lets an admin edit and delete a note another admin wrote on an account it may act on", async () => {
    const edited = await patch({
      action: "edit_note",
      userId: C,
      noteId: 13,
      note: "corrected",
    });
    expect(edited.status).toBe(200);
    expect(noteText(13)).toBe("corrected");
    expect(mockLogAction).toHaveBeenCalledWith(
      A,
      C,
      "edit_note",
      expect.any(String),
      "127.0.0.1",
    );

    const deleted = await patch({
      action: "delete_note",
      userId: C,
      noteId: 13,
    });
    expect(deleted.status).toBe(200);
    expect(noteText(13)).toBeUndefined();
  });
});

describe("a note about the caller", () => {
  it("edit_note: refuses a note the super admin wrote about the caller", async () => {
    const res = await patch({
      action: "edit_note",
      userId: A,
      noteId: 11,
      note: "nothing to see",
    });
    expect(res.status).toBe(403);
    expect(noteText(11)).toBe("about A, by S");
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("delete_note: refuses a note the super admin wrote about the caller", async () => {
    const res = await patch({ action: "delete_note", userId: A, noteId: 11 });
    expect(res.status).toBe(403);
    expect(noteText(11)).toBe("about A, by S");
    expect(mockLogAction).not.toHaveBeenCalled();
  });

  it("still lets the caller edit and delete a note they wrote about themselves", async () => {
    const edited = await patch({
      action: "edit_note",
      userId: A,
      noteId: 12,
      note: "typo fixed",
    });
    expect(edited.status).toBe(200);
    expect(noteText(12)).toBe("typo fixed");

    const deleted = await patch({
      action: "delete_note",
      userId: A,
      noteId: 12,
    });
    expect(deleted.status).toBe(200);
    expect(noteText(12)).toBeUndefined();
  });
});
