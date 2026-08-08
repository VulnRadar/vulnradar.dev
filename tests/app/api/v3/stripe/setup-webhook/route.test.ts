/**
 * Tests for GET /api/v3/stripe/setup-webhook.
 *
 * The database and session are mocked (network/DB boundary). The route
 * calls lib/billing/stripe-webhook-setup's ensureStripeWebhook() as its one
 * unit of business logic; that function has its own dedicated suite
 * exercising it against the getStripe() boundary for real, so here it is
 * mocked directly, one layer up from the route.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Query mock routes by SQL text (role lookup vs. the settings resolver's
// system_settings read) rather than call order, since BILLING_ENABLED now
// resolves through lib/config/runtime-config's getSetting() -> pool.query().
let roleRow: { role: string } | null = { role: "admin" };
let settingsRows: { key: string; value: string }[] = [];
const mockQuery = vi.fn(async (sql: string, params?: unknown[]) => {
  const s = String(sql).trim();
  if (s.startsWith("SELECT role FROM users")) {
    return { rows: roleRow ? [roleRow] : [] };
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

const mockEnsureStripeWebhook = vi.fn();
vi.mock("@/lib/billing/stripe-webhook-setup", () => ({
  ensureStripeWebhook: (...args: unknown[]) => mockEnsureStripeWebhook(...args),
}));

const { GET } = await import("@/app/api/v3/stripe/setup-webhook/route");
const { invalidateSettingsCache } = await import("@/lib/config/runtime-config");

const ENV_KEYS = [
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  mockQuery.mockClear();
  roleRow = { role: "admin" };
  settingsRows = []; // empty -> BILLING_ENABLED resolves to its shipped default (true)
  invalidateSettingsCache();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ userId: 1 });
  mockEnsureStripeWebhook.mockReset();
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

describe("GET /api/v3/stripe/setup-webhook", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a non-admin caller with 401", async () => {
    roleRow = { role: "user" };
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockEnsureStripeWebhook).not.toHaveBeenCalled();
  });

  it("short-circuits to configured:true when STRIPE_WEBHOOK_SECRET is already set, without calling ensureStripeWebhook", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_already_set";

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      message: "Webhook is configured",
      configured: true,
    });
    expect(mockEnsureStripeWebhook).not.toHaveBeenCalled();
  });

  it("returns billingEnabled: false and skips setup when billing is disabled", async () => {
    settingsRows = [{ key: "BILLING_ENABLED", value: "false" }];

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      success: true,
      message: "Billing is disabled in config.yaml - webhook setup skipped",
      billingEnabled: false,
    });
    expect(mockEnsureStripeWebhook).not.toHaveBeenCalled();
  });

  it("returns 500 when STRIPE_SECRET_KEY is not set", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://vulnradar.example";

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/STRIPE_SECRET_KEY/);
  });

  it("returns 500 when NEXT_PUBLIC_APP_URL is not set", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/NEXT_PUBLIC_APP_URL/);
  });

  it("surfaces the error when ensureStripeWebhook fails", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.NEXT_PUBLIC_APP_URL = "https://vulnradar.example";
    mockEnsureStripeWebhook.mockResolvedValue({
      success: false,
      error: "boom",
    });

    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("boom");
    expect(json.billingEnabled).toBe(true);
  });

  it("returns the webhook secret and a copy-it message for a freshly created webhook", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.NEXT_PUBLIC_APP_URL = "https://vulnradar.example";
    mockEnsureStripeWebhook.mockResolvedValue({
      success: true,
      webhookId: "we_1",
      webhookSecret: "whsec_new",
      alreadyExists: false,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.webhookId).toBe("we_1");
    expect(json.webhookSecret).toBe("whsec_new");
    expect(json.webhookSecretConfigured).toBe(false);
    expect(json.message).toMatch(/NEW WEBHOOK CREATED/);
    expect(json.webhookUrl).toBe(
      "https://vulnradar.example/api/v3/webhooks/stripe",
    );
  });

  it("omits webhookSecret and reports the already-exists message when the webhook already exists", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.NEXT_PUBLIC_APP_URL = "https://vulnradar.example";
    mockEnsureStripeWebhook.mockResolvedValue({
      success: true,
      webhookId: "we_1",
      alreadyExists: true,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhookSecret).toBeUndefined();
    expect(json.message).toMatch(/already exists/);
  });
});
