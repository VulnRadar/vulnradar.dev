import { describe, it, expect, beforeEach, vi } from "vitest";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const { findAccountForSubscriptionEvent } =
  await import("@/lib/billing/subscription-lookup");

/**
 * What the real query returns is proven against Postgres in
 * tests/integration/subscription-lookup.test.ts. This file covers what does
 * not need a database: when it asks at all, what it binds, and that a failed
 * read can never take the webhook down with it.
 */
describe("findAccountForSubscriptionEvent", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("runs no query when there is no key to look up", async () => {
    await expect(findAccountForSubscriptionEvent({})).resolves.toBeNull();
    await expect(
      findAccountForSubscriptionEvent({
        userId: null,
        customerId: "",
        email: null,
      }),
    ).resolves.toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("binds exactly the keys it was given, null for the rest", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 7 }] });

    await expect(
      findAccountForSubscriptionEvent({ customerId: "cus_1" }),
    ).resolves.toBe(7);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain("FROM users");
    expect(params).toEqual([null, "cus_1", null]);
  });

  it("drops a NaN user id, which parseInt of bad metadata produces, instead of binding it", async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await findAccountForSubscriptionEvent({
      userId: Number.NaN,
      email: "a@b.com",
    });

    expect(mockQuery.mock.calls[0][1]).toEqual([null, null, "a@b.com"]);
  });

  it("answers null for no row", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(
      findAccountForSubscriptionEvent({ userId: 1 }),
    ).resolves.toBeNull();
  });

  it("logs and answers null when the read fails, rather than throwing into the webhook", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("connection reset");
    mockQuery.mockRejectedValue(boom);

    await expect(
      findAccountForSubscriptionEvent({ userId: 1, customerId: "cus_1" }),
    ).resolves.toBeNull();

    const row = errSpy.mock.calls.find((c) =>
      String(c[0]).startsWith("[stripe]"),
    );
    expect(row).toBeDefined();
    expect(row).toContain(boom);
    errSpy.mockRestore();
  });
});
