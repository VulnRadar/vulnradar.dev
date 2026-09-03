/**
 * Route-level tests for GET /api/v3/billing/plan-limits.
 *
 * This is the route that closes AUDIT-011#drift-10: the pricing table, the
 * plan cards and the upgrade surfaces used to render the hardcoded
 * lib/billing/catalog.ts copy while enforcement resolved the admin-editable
 * BILLING_* settings, so one edit in /admin desynchronised the advertised
 * number from the charged one. The point of the route is that it reads the
 * SAME resolver the API enforces against, so what matters here is that it
 * returns the resolved settings rather than the catalog values, for all four
 * plans and every field.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { PLANS } from "@/lib/billing/catalog";

// The route reads no rows itself; the pool is only pulled in transitively by
// lib/billing/plan-limits.ts's import of the plan resolver, which needs a
// DATABASE_URL at module load.
vi.mock("@/lib/database/db", () => ({
  default: { query: vi.fn() },
}));

const mockGetSetting = vi.fn();
const mockGetSettings = vi.fn();
vi.mock("@/lib/config/runtime-config", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
}));

const { GET } = await import("@/app/api/v3/billing/plan-limits/route");

/** Resolve every requested key to `value`, the shape getSettings returns. */
function resolveAllTo(value: number) {
  return async (keys: readonly string[]) =>
    Object.fromEntries(keys.map((k) => [k, value]));
}

beforeEach(() => {
  mockGetSetting.mockReset();
  mockGetSettings.mockReset();
});

describe("GET /api/v3/billing/plan-limits", () => {
  it("returns one entry per plan, with every PlanLimits field", async () => {
    mockGetSettings.mockImplementation(resolveAllTo(7));

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(
      [...PLANS].map((p) => p.id).sort(),
    );
    for (const plan of PLANS) {
      expect(Object.keys(json[plan.id]).sort()).toEqual(
        Object.keys(plan.limits).sort(),
      );
    }
  });

  it("reports the RESOLVED settings, not the catalog copy", async () => {
    // The whole point of the route. 999 is a value no plan ships, so a
    // response carrying it can only have come from the resolver.
    mockGetSettings.mockImplementation(resolveAllTo(999));

    const json = await (await GET()).json();

    for (const plan of PLANS) {
      for (const field of Object.keys(plan.limits)) {
        expect(json[plan.id][field]).toBe(999);
      }
    }
    // And it really is different from what the catalog would have said.
    expect(json.free.dailyScans).not.toBe(PLANS[0].limits.dailyScans);
  });

  it("resolves all four plans' settings in a single getSettings call", async () => {
    mockGetSettings.mockImplementation(resolveAllTo(1));

    await GET();

    expect(mockGetSettings).toHaveBeenCalledTimes(1);
    const requested = mockGetSettings.mock.calls[0][0] as string[];
    // 4 plans x 13 fields, every key distinct.
    const fieldCount = Object.keys(PLANS[0].limits).length;
    expect(requested).toHaveLength(PLANS.length * fieldCount);
    expect(new Set(requested).size).toBe(requested.length);
    expect(requested.every((k) => k.startsWith("BILLING_"))).toBe(true);
  });

  it("falls back to the catalog value for a setting that does not resolve to a number", async () => {
    // A missing or malformed row must not put NaN in front of someone
    // deciding what to pay.
    mockGetSettings.mockImplementation(async (keys: readonly string[]) =>
      Object.fromEntries(keys.map((k) => [k, undefined])),
    );

    const json = await (await GET()).json();

    for (const plan of PLANS) {
      for (const [field, value] of Object.entries(plan.limits)) {
        expect(json[plan.id][field]).toBe(value);
      }
    }
  });

  it("does not gate on BILLING_ENABLED: a comparison still has to state each tier's numbers", async () => {
    mockGetSetting.mockResolvedValue(false);
    mockGetSettings.mockImplementation(resolveAllTo(5));

    const res = await GET();

    expect(res.status).toBe(200);
    expect((await res.json()).free.dailyScans).toBe(5);
  });

  it("answers 500 rather than a half-built table when the resolver throws", async () => {
    mockGetSettings.mockRejectedValue(new Error("db down"));

    const res = await GET();

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
  });
});
