/**
 * Tests for GET /api/v3/stripe/setup-products.
 *
 * Admin-only endpoint that writes to the live Stripe product catalog. The
 * database, session, and Stripe SDK client (getStripe()) are mocked; the
 * real PRODUCTS catalog (lib/billing/products.ts) drives the loop so this
 * suite catches drift between the catalog and what the route actually
 * creates in Stripe.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// BILLING_ENABLED now resolves through lib/config/runtime-config's
// getSetting() -> pool.query() against system_settings. Empty rows (the
// default here) resolve to the shipped default (true).
let settingsRows: { key: string; value: string }[] = [];
// requireAdmin does its own SELECT role, totp_enabled lookup rather than
// trusting the session object, so the role under test lives here.
let roleRow: { role: string } | null = { role: "admin" };
const mockQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  const s = String(sql).trim();
  if (
    s.startsWith("SELECT id, role, totp_enabled FROM users") ||
    s.startsWith("SELECT role, totp_enabled FROM users")
  ) {
    return {
      rows: roleRow ? [{ id: 1, totp_enabled: true, ...roleRow }] : [],
    };
  }
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: settingsRows };
  }
  return { rows: [] };
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

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

const { PRODUCTS } = await import("@/lib/billing/products");
const { GET } = await import("@/app/api/v3/stripe/setup-products/route");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

beforeEach(() => {
  mockQuery.mockClear();
  settingsRows = [];
  invalidateSettingsCache();
  mockGetSession.mockReset();
  roleRow = { role: "admin" };
  mockGetSession.mockResolvedValue({ userId: 1 });
  mockGetStripe.mockReset();
  mockGetStripe.mockReturnValue(null);
});

function fakeStripe(overrides: {
  search?: (arg: { query: string }) => Promise<{ data: unknown[] }>;
  productsCreate?: (...args: unknown[]) => Promise<unknown>;
  pricesList?: (arg: { product: string }) => Promise<{ data: unknown[] }>;
  pricesCreate?: (...args: unknown[]) => Promise<unknown>;
}) {
  return {
    products: {
      search: vi.fn(overrides.search ?? (async () => ({ data: [] }))),
      create: vi.fn(
        overrides.productsCreate ??
          (async (args: { name: string }) => ({
            id: `prod_new_${args.name.replace(/\s+/g, "_")}`,
          })),
      ),
    },
    prices: {
      list: vi.fn(overrides.pricesList ?? (async () => ({ data: [] }))),
      create: vi.fn(
        overrides.pricesCreate ?? (async () => ({ id: "price_new_1" })),
      ),
    },
  };
}

describe("GET /api/v3/stripe/setup-products", () => {
  // 403 rather than 401: requireAdmin collapses "no session" and "not an
  // admin" into null, so the route answers the same to both. Matches
  // app/api/v3/admin/teams, and tells an anonymous caller nothing.
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller with 403, never touching Stripe", async () => {
    roleRow = { role: "user" };
    mockGetSession.mockResolvedValue({ userId: 2 });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("returns 400 when billing is disabled", async () => {
    settingsRows = [{ key: "BILLING_ENABLED", value: "false" }];

    const res = await GET();
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Billing is disabled in config.yaml");
  });

  it("returns 500 when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null);
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Stripe is not configured/);
  });

  it("reuses an existing product+price and creates a new product+price for others, covering every PRODUCTS entry", async () => {
    const existingProductId = "prod_existing_1";
    const firstProduct = PRODUCTS[0];

    const stripe = fakeStripe({
      search: async (arg: { query: string }) => {
        if (arg.query.includes(firstProduct.id)) {
          return { data: [{ id: existingProductId }] };
        }
        return { data: [] };
      },
      pricesList: async ({ product }: { product: string }) => {
        if (product === existingProductId) {
          return {
            data: [
              {
                id: "price_existing_1",
                unit_amount: firstProduct.priceInCents,
                recurring: { interval: firstProduct.interval },
              },
            ],
          };
        }
        return { data: [] };
      },
    });
    mockGetStripe.mockReturnValue(stripe);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.products).toHaveLength(PRODUCTS.length);

    const firstResult = json.products[0];
    expect(firstResult.alreadyExists).toBe(true);
    expect(firstResult.priceId).toBe("price_existing_1");
    expect(stripe.prices.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ product: existingProductId }),
    );

    const secondResult = json.products[1];
    expect(secondResult.alreadyExists).toBe(false);
    expect(stripe.products.create).toHaveBeenCalled();
    expect(stripe.prices.create).toHaveBeenCalled();

    // Every product lookup queried Stripe with its own vulnradar_id.
    expect(stripe.products.search).toHaveBeenCalledTimes(PRODUCTS.length);
    for (const product of PRODUCTS) {
      expect(stripe.products.search).toHaveBeenCalledWith({
        query: expect.stringContaining(`vulnradar_id`) as unknown as string,
      });
      expect(
        stripe.products.search.mock.calls.some(([arg]: [{ query: string }]) =>
          arg.query.includes(product.id),
        ),
      ).toBe(true);
    }
  });

  it("returns 500 with the thrown error's message when a Stripe call fails mid-loop", async () => {
    const stripe = fakeStripe({
      search: async () => {
        throw new Error("stripe rate limited");
      },
    });
    mockGetStripe.mockReturnValue(stripe);

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("stripe rate limited");
  });
});
