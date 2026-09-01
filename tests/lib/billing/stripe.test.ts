import {
  describe,
  it,
  expect,
  beforeAll,
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

// Pay the cold-import cost of the module graph in a hook rather than inside
// the first test. Every test here calls vi.resetModules() and re-imports
// @/lib/billing/stripe, which pulls in the stripe SDK and the whole
// lib/config/constants -> config-values chain. Measured standalone: the first
// import takes ~660ms and each subsequent one ~20ms, because vite's transform
// cache survives resetModules even though the module registry does not. Under
// `vitest run --coverage` (v8 instruments every one of those modules) with the
// suite's parallel forks all competing, that first import crossed the default
// 5000ms per-test budget and the run failed on "billing disabled, no key" with
// a timeout rather than an assertion. Hooks get their own 10s budget, so
// warming the graph here keeps the timed tests measuring behaviour instead of
// transform throughput. Nothing is loosened: the assertions below are
// unchanged and still fail if the gating is wrong.
// The explicit budget is deliberate: this hook does one thing, and what it
// measures is how long a cold instrumented transform takes on a contended
// runner, which is not a property of the code under test.
beforeAll(async () => {
  await import("@/lib/billing/stripe");
}, 30_000);

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

async function loadWithBillingEnabled(
  billingEnabled: boolean,
  /**
   * The value STRIPE_SECRET_KEY must hold when the assertion runs. Pass
   * `null` for "must be absent".
   *
   * isStripeEnabled() reads process.env at CALL time, and process.env is
   * shared by every test file in the worker. Three other suites
   * (stripe-webhook-setup, api/v3/stripe/setup-webhook, github-repo-scan)
   * assign STRIPE_SECRET_KEY, so clearing it in beforeEach left a window in
   * which one of them could set it again between that hook and the
   * expectation here. That is the intermittent "billing disabled, no key"
   * failure: the suite passed in isolation and failed under a full run.
   * Setting the value immediately before the module loads, rather than a
   * hook earlier, closes the window.
   */
  secretKey: string | null = null,
) {
  if (secretKey === null) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = secretKey;
  }
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
    const { isStripeEnabled, getStripe } = await loadWithBillingEnabled(
      false,
      "sk_test_fake_key_for_tests",
    );
    expect(isStripeEnabled()).toBe(false);
    expect(getStripe()).toBeNull();
  });

  it("billing enabled, no key: disabled and null", async () => {
    const { isStripeEnabled, getStripe } = await loadWithBillingEnabled(true);
    expect(isStripeEnabled()).toBe(false);
    expect(getStripe()).toBeNull();
  });

  it("billing enabled with a key: enabled, returns a cached Stripe instance", async () => {
    const { isStripeEnabled, getStripe } = await loadWithBillingEnabled(
      true,
      "sk_test_fake_key_for_tests",
    );

    expect(isStripeEnabled()).toBe(true);

    const first = getStripe();
    expect(first).toBeTruthy();
    expect(first).toHaveProperty("webhooks");

    const second = getStripe();
    expect(second).toBe(first);
  });
});
