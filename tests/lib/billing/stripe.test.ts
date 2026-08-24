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
// throws when loaded outside webpack's react-server condition (which is
// what makes it a build-time guard against client-bundling server code).
// Under plain Node (vitest) it must be neutralized to load the real module.
vi.mock("server-only", () => ({}));

/**
 * getStripe()/isStripeEnabled() are the boundary every billing route and
 * lib function gates on. BILLING_ENABLED is a compile-time constant, so
 * each test mocks @/lib/config/constants and re-imports the module fresh
 * with vi.resetModules() to see a different value. Constructing a real
 * Stripe instance never touches the network, so no mocking is needed for
 * the "enabled" path itself.
 */

const originalKey = process.env.STRIPE_SECRET_KEY;

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  // Defensive isolation: start every test with no stale constants mock and a
  // fresh module registry, so a prior test's doMock/import can never leak into
  // this one (the documented "billing disabled" flake under parallel load).
  vi.doUnmock("@/lib/config/constants");
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("@/lib/config/constants");
  vi.resetModules();
});

afterAll(() => {
  if (originalKey === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = originalKey;
  }
});

async function loadWithBillingEnabled(billingEnabled: boolean) {
  vi.doMock("@/lib/config/constants", async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("@/lib/config/constants")>();
    return { ...actual, BILLING_ENABLED: billingEnabled };
  });
  vi.resetModules();
  return import("@/lib/billing/stripe");
}

describe("isStripeEnabled / getStripe", () => {
  it("billing disabled, no key: disabled and null", async () => {
    const { isStripeEnabled, getStripe } = await loadWithBillingEnabled(false);
    expect(isStripeEnabled()).toBe(false);
    expect(getStripe()).toBeNull();
  });

  it("billing disabled overrides a configured key: still disabled and null", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
    const { isStripeEnabled, getStripe } = await loadWithBillingEnabled(false);
    expect(isStripeEnabled()).toBe(false);
    expect(getStripe()).toBeNull();
  });

  it("billing enabled, no key: disabled and null", async () => {
    const { isStripeEnabled, getStripe } = await loadWithBillingEnabled(true);
    expect(isStripeEnabled()).toBe(false);
    expect(getStripe()).toBeNull();
  });

  it("billing enabled with a key: enabled, returns a cached Stripe instance", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_tests";
    const { isStripeEnabled, getStripe } = await loadWithBillingEnabled(true);

    expect(isStripeEnabled()).toBe(true);

    const first = getStripe();
    expect(first).toBeTruthy();
    expect(first).toHaveProperty("webhooks");

    const second = getStripe();
    expect(second).toBe(first);
  });
});
