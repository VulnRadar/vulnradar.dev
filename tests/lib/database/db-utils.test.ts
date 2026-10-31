import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Tests for lib/database/db-utils.ts. The file was trimmed to its one live
 * helper, getUserByEmail (the generic CRUD/batch utilities it used to hold had
 * zero callers and were removed), so this suite covers only that.
 *
 * `pool` from @/lib/database/db is mocked at the wire boundary these helpers
 * call, matching this repo's "mock at the database boundary, not below it" rule.
 */

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { getUserByEmail } = await import("@/lib/database/db-utils");

beforeEach(() => {
  mockQuery.mockReset();
});

describe("getUserByEmail", () => {
  it("lowercases and trims the email before querying", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "u@x.com" }] });
    await getUserByEmail("  User@X.COM  ");
    expect(mockQuery.mock.calls[0][1]).toEqual(["user@x.com"]);
  });

  it("returns the row when one matches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, email: "u@x.com" }] });
    expect(await getUserByEmail("u@x.com")).toEqual({
      id: 1,
      email: "u@x.com",
    });
  });

  it("returns null when no row matches", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await getUserByEmail("nobody@x.com")).toBeNull();
  });

  it("lets a database error propagate instead of reporting 'no such user'", async () => {
    // A null here reads as "this address has no account", and login answers
    // that with 401. An outage must surface as an outage.
    mockQuery.mockRejectedValueOnce(new Error("down"));
    await expect(getUserByEmail("u@x.com")).rejects.toThrow("down");
  });
});
