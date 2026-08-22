import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";

// "server-only" is a Next.js bundler marker package that unconditionally
// throws when loaded outside webpack's react-server condition. Under plain
// Node (vitest) it must be neutralized to load the real module.
vi.mock("server-only", () => ({}));

/**
 * ensureStripeWebhook() is the idempotent "make sure our webhook endpoint
 * exists in Stripe" routine behind /api/v3/stripe/setup-webhook. Stripe is
 * mocked at the getStripe() boundary. BILLING_ENABLED now resolves through
 * lib/config/runtime-config's getSetting(), which is mocked here at the
 * database boundary (pool.query against system_settings), the same pattern
 * used by tests/lib/rate-limiting/rate-limit.test.ts and
 * tests/lib/auth/auth.test.ts. The required env vars are still exercised
 * for real via per-test module reloads.
 */

const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

let settingsRows: { key: string; value: string }[] = [];
const mockDbQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  const s = String(sql).trim();
  if (s.startsWith("SELECT key, value FROM system_settings")) {
    return { rows: settingsRows };
  }
  return { rows: [] };
});
vi.mock("@/lib/database/db", () => ({
  default: {
    query: (sql: string, params?: unknown[]) => mockDbQuery(sql, params),
  },
}));

const originalSecretKey = process.env.STRIPE_SECRET_KEY;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  mockGetStripe.mockReset();
  mockDbQuery.mockClear();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_APP_URL;
});

afterEach(() => {
  vi.resetModules();
});

afterAll(() => {
  if (originalSecretKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalSecretKey;
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
});

async function loadWithBillingEnabled(billingEnabled: boolean) {
  settingsRows = [{ key: "BILLING_ENABLED", value: String(billingEnabled) }];
  // resetModules gives the settings resolver's module-level cache a fresh
  // start too, so each call here sees exactly the rows just set above.
  vi.resetModules();
  return import("@/lib/billing/stripe-webhook-setup");
}

// Imported from the source (not re-declared) so this test can never drift
// out of sync with the actual required-events list -- adding an event there
// is meant to backfill onto live webhooks, and this asserts exactly that.
const { REQUIRED_EVENTS } = await import("@/lib/billing/stripe-webhook-setup");

describe("ensureStripeWebhook", () => {
  it("skips entirely when billing is disabled, without calling getStripe", async () => {
    const { ensureStripeWebhook } = await loadWithBillingEnabled(false);
    const result = await ensureStripeWebhook();
    expect(result).toEqual({
      success: true,
      error: "Billing is disabled - webhook not needed",
    });
    expect(mockGetStripe).not.toHaveBeenCalled();
  });

  it("fails when STRIPE_SECRET_KEY is not set", async () => {
    const { ensureStripeWebhook } = await loadWithBillingEnabled(true);
    const result = await ensureStripeWebhook();
    expect(result).toEqual({
      success: false,
      error: "STRIPE_SECRET_KEY is not set",
    });
  });

  it("fails when NEXT_PUBLIC_APP_URL is not set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const { ensureStripeWebhook } = await loadWithBillingEnabled(true);
    const result = await ensureStripeWebhook();
    expect(result).toEqual({
      success: false,
      error: "NEXT_PUBLIC_APP_URL is not set",
    });
  });

  it("fails when getStripe() returns null despite both env vars being set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    mockGetStripe.mockReturnValue(null);
    const { ensureStripeWebhook } = await loadWithBillingEnabled(true);
    const result = await ensureStripeWebhook();
    expect(result).toEqual({
      success: false,
      error: "Stripe is not configured",
    });
  });

  it("returns the existing webhook unchanged when it already has all required events", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const update = vi.fn();
    mockGetStripe.mockReturnValue({
      webhookEndpoints: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              id: "we_1",
              url: "https://app.example.com/api/v3/webhooks/stripe",
              status: "enabled",
              enabled_events: REQUIRED_EVENTS,
            },
          ],
        }),
        update,
        create: vi.fn(),
      },
    });

    const { ensureStripeWebhook } = await loadWithBillingEnabled(true);
    const result = await ensureStripeWebhook();

    expect(result).toEqual({
      success: true,
      webhookId: "we_1",
      alreadyExists: true,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates the existing webhook when it's missing required events", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const update = vi.fn().mockResolvedValue({ id: "we_1" });
    mockGetStripe.mockReturnValue({
      webhookEndpoints: {
        list: vi.fn().mockResolvedValue({
          data: [
            {
              id: "we_1",
              url: "https://app.example.com/api/v3/webhooks/stripe",
              status: "enabled",
              enabled_events: ["checkout.session.completed"],
            },
          ],
        }),
        update,
        create: vi.fn(),
      },
    });

    const { ensureStripeWebhook } = await loadWithBillingEnabled(true);
    const result = await ensureStripeWebhook();

    expect(update).toHaveBeenCalledWith("we_1", {
      enabled_events: REQUIRED_EVENTS,
    });
    expect(result).toEqual({
      success: true,
      webhookId: "we_1",
      alreadyExists: true,
    });
  });

  it("creates a new webhook when none matches, returning the secret", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const create = vi.fn().mockResolvedValue({
      id: "we_new",
      secret: "whsec_new123",
    });
    mockGetStripe.mockReturnValue({
      webhookEndpoints: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        update: vi.fn(),
        create,
      },
    });

    const { ensureStripeWebhook } = await loadWithBillingEnabled(true);
    const result = await ensureStripeWebhook();

    expect(create).toHaveBeenCalledWith({
      url: "https://app.example.com/api/v3/webhooks/stripe",
      enabled_events: REQUIRED_EVENTS,
      description: expect.stringContaining("https://app.example.com"),
    });
    expect(result).toEqual({
      success: true,
      webhookId: "we_new",
      webhookSecret: "whsec_new123",
      alreadyExists: false,
    });
  });

  it("catches a Stripe API error and returns it as a failure result", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    mockGetStripe.mockReturnValue({
      webhookEndpoints: {
        list: vi.fn().mockRejectedValue(new Error("network blip")),
        update: vi.fn(),
        create: vi.fn(),
      },
    });

    const { ensureStripeWebhook } = await loadWithBillingEnabled(true);
    const result = await ensureStripeWebhook();

    expect(result).toEqual({ success: false, error: "network blip" });
  });
});

describe("ensureStripeWebhookOnce", () => {
  it("caches the result and only runs the setup once per module instance", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
    const list = vi.fn().mockResolvedValue({
      data: [
        {
          id: "we_1",
          url: "https://app.example.com/api/v3/webhooks/stripe",
          status: "enabled",
          enabled_events: REQUIRED_EVENTS,
        },
      ],
    });
    mockGetStripe.mockReturnValue({
      webhookEndpoints: { list, update: vi.fn(), create: vi.fn() },
    });

    const { ensureStripeWebhookOnce } = await loadWithBillingEnabled(true);

    const [first, second] = await Promise.all([
      ensureStripeWebhookOnce(),
      ensureStripeWebhookOnce(),
    ]);

    expect(first).toBe(second);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
