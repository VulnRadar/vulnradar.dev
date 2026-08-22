/**
 * Tests for POST /api/v3/webhooks/stripe.
 *
 * This is the most security-critical route in the billing surface: it is
 * the one endpoint an attacker can call without a session, so signature
 * verification has to be real, not mocked away. The pg pool is mocked
 * (network/DB boundary) and getStripe() is mocked to return a client whose
 * `.webhooks` namespace is a REAL Stripe SDK instance (pure local
 * HMAC-SHA256 verification, no network call, no API-key validation) so
 * `constructEvent` runs its actual signature check against a genuinely
 * signed (or genuinely tampered) payload. Only the Stripe *business* API
 * calls (subscriptions.retrieve, customers.retrieve) are mocked.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import Stripe from "stripe";

const mockQuery = vi.fn();
vi.mock("@/lib/database/db", () => ({
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSubRetrieve = vi.fn();
const mockCustomerRetrieve = vi.fn();
const mockGetStripe = vi.fn();
vi.mock("@/lib/billing/stripe", () => ({
  getStripe: () => mockGetStripe(),
}));

const { POST } = await import("@/app/api/v3/webhooks/stripe/route");

// A real Stripe SDK instance purely to get the real, local, network-free
// webhooks.constructEvent / generateTestHeaderString implementation.
const realWebhooks = new Stripe("sk_test_fake_key_for_signature_tests_only")
  .webhooks;

const WEBHOOK_SECRET = "whsec_test_secret_for_signing_only";
const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterAll(() => {
  if (originalWebhookSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  }
});

function signedRequest(payload: string, secret = WEBHOOK_SECRET): NextRequest {
  const header = realWebhooks.generateTestHeaderString({ payload, secret });
  return new NextRequest("http://localhost/api/v3/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": header },
    body: payload,
  });
}

function unsignedRequest(
  payload: string,
  signatureHeader?: string,
): NextRequest {
  return new NextRequest("http://localhost/api/v3/webhooks/stripe", {
    method: "POST",
    headers: signatureHeader ? { "stripe-signature": signatureHeader } : {},
    body: payload,
  });
}

function fakeStripe() {
  return {
    webhooks: realWebhooks,
    subscriptions: { retrieve: mockSubRetrieve },
    customers: { retrieve: mockCustomerRetrieve },
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockSubRetrieve.mockReset();
  mockCustomerRetrieve.mockReset();
  mockGetStripe.mockReset();
  mockGetStripe.mockReturnValue(fakeStripe());
});

const badgeRow = { rows: [{ id: 9 }] };

describe("POST /api/v3/webhooks/stripe: transport and signature verification", () => {
  it("returns 503 without reading the body/signature when Stripe is not configured", async () => {
    mockGetStripe.mockReturnValue(null);
    const res = await POST(unsignedRequest("{}"));
    expect(res.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a request with no stripe-signature header at all", async () => {
    const res = await POST(unsignedRequest(JSON.stringify({ id: "evt_1" })));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid signature");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a tampered payload signed for a different body", async () => {
    const signedForA = realWebhooks.generateTestHeaderString({
      payload: JSON.stringify({ id: "evt_A" }),
      secret: WEBHOOK_SECRET,
    });
    const res = await POST(
      unsignedRequest(JSON.stringify({ id: "evt_B_tampered" }), signedForA),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid signature");
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a syntactically-present but garbage signature", async () => {
    const garbage = `t=${Math.floor(Date.now() / 1000)},v1=deadbeef`;
    const res = await POST(
      unsignedRequest(JSON.stringify({ id: "evt_1" }), garbage),
    );
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const payload = JSON.stringify({ id: "evt_1" });
    const wrongSecretHeader = realWebhooks.generateTestHeaderString({
      payload,
      secret: "whsec_totally_different_secret",
    });
    const res = await POST(unsignedRequest(payload, wrongSecretHeader));
    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("accepts a genuinely, correctly signed payload", async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ event_id: "evt_ok" }],
    });
    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_ok",
          type: "customer.created",
          data: { object: {} },
        }),
      ),
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/v3/webhooks/stripe: idempotency", () => {
  it("short-circuits on a replayed event without running any handler logic", async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_replay",
          type: "invoice.payment_failed",
          data: { object: { customer: "cus_1" } },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ received: true, replay: true });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("still processes the event when the idempotency check itself fails (table missing)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("relation does not exist"));
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 42, email: "a@b.com" }],
    }); // UPDATE users
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge INSERT

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_no_idem_table",
          type: "checkout.session.completed",
          data: {
            object: {
              customer: "cus_1",
              subscription: "sub_1",
              customer_email: null,
              metadata: { userId: "42", planId: "pro_supporter" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.replay).toBeUndefined();
    // Idempotency insert attempt + UPDATE + 2 badge queries.
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });
});

function withIdempotency(eventId: string) {
  mockQuery.mockResolvedValueOnce({
    rowCount: 1,
    rows: [{ event_id: eventId }],
  });
}

describe("POST /api/v3/webhooks/stripe: checkout.session.completed", () => {
  it("upgrades the user by userId and grants the premium badge", async () => {
    withIdempotency("evt_checkout_1");
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 42, email: "a@b.com" }],
    }); // UPDATE by userId
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge INSERT

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_checkout_1",
          type: "checkout.session.completed",
          data: {
            object: {
              customer: "cus_1",
              subscription: "sub_1",
              customer_email: "ignored@example.com",
              metadata: { userId: "42", planId: "pro_supporter" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(4);

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("WHERE id = $5");
    expect(params).toEqual(["pro_supporter", "cus_1", "sub_1", "active", 42]);

    const [badgeSelectSql] = mockQuery.mock.calls[2];
    expect(badgeSelectSql).toContain("badges WHERE name = 'premium'");
    const [badgeInsertSql, badgeInsertParams] = mockQuery.mock.calls[3];
    expect(badgeInsertSql).toContain("user_badges");
    expect(badgeInsertParams).toEqual([42, 9]);
  });

  it("falls back to matching by email when there is no userId, without granting a badge or throwing when no user matches", async () => {
    withIdempotency("evt_checkout_2");
    // No valid planId in metadata -> tries the subscription-metadata fallback.
    mockSubRetrieve.mockResolvedValue({
      metadata: {},
      items: { data: [{ price: { nickname: "" } }] },
    });
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // UPDATE by email, no match

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_checkout_2",
          type: "checkout.session.completed",
          data: {
            object: {
              customer: "cus_9",
              subscription: "sub_9",
              customer_email: "who@example.com",
              metadata: {},
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockSubRetrieve).toHaveBeenCalledWith("sub_9");
    expect(mockQuery).toHaveBeenCalledTimes(2); // idempotency + email UPDATE only, no badge queries

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("LOWER(email) = LOWER($5)");
    expect(params[0]).toBe("free");
    expect(params[4]).toBe("who@example.com");
  });

  it("withholds BOTH the plan and the badge when the session's payment_status is unpaid", async () => {
    withIdempotency("evt_checkout_unpaid");
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 42, email: "a@b.com" }],
    }); // UPDATE by userId

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_checkout_unpaid",
          type: "checkout.session.completed",
          data: {
            object: {
              customer: "cus_1",
              subscription: "sub_1",
              customer_email: "ignored@example.com",
              payment_status: "unpaid",
              metadata: { userId: "42", planId: "pro_supporter" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    // Idempotency + UPDATE only -- no badge SELECT/INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("plan = $1");
    expect(params[0]).toBe("free");
    expect(params[3]).toBe("incomplete");
  });
});

describe("POST /api/v3/webhooks/stripe: payment_intent.succeeded (AI credit purchase)", () => {
  it("credits the purchasing user's AI token balance via the idempotent credit function", async () => {
    withIdempotency("evt_pi_1");
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ payment_intent_id: "pi_1" }],
    }); // ai_credit_purchases INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // addAiCreditBalance UPDATE

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_pi_1",
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: "pi_1",
              metadata: { userId: "42", aiCreditTierId: "ai_credits_1m" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    // Idempotency INSERT + ai_credit_purchases INSERT + balance UPDATE.
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [insertSql, insertParams] = mockQuery.mock.calls[1];
    expect(insertSql).toContain("INSERT INTO ai_credit_purchases");
    expect(insertParams).toEqual(["pi_1", 42, 1_000_000]);
    const [updateSql, updateParams] = mockQuery.mock.calls[2];
    expect(updateSql).toContain("ai_credit_balance = ai_credit_balance + $2");
    expect(updateParams).toEqual([42, 1_000_000]);
  });

  it("does not double-credit when the ai_credit_purchases guard already has this payment intent recorded (e.g. confirmAiCreditPurchase already applied it)", async () => {
    withIdempotency("evt_pi_2");
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // ai_credit_purchases INSERT conflicts

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_pi_2",
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: "pi_2",
              metadata: { userId: "42", aiCreditTierId: "ai_credits_1m" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    // Idempotency INSERT + the ai_credit_purchases INSERT attempt only --
    // addAiCreditBalance was never reached.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it("silently no-ops for a PaymentIntent with no aiCreditTierId metadata (e.g. a subscription invoice's own PaymentIntent)", async () => {
    withIdempotency("evt_pi_sub");

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_pi_sub",
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: "pi_sub_1",
              metadata: { userId: "42" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    // Idempotency INSERT only -- every PaymentIntent Stripe creates fires
    // this event, including a subscription's own invoice PaymentIntent.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("logs and does not credit anything when aiCreditTierId is present but does not resolve to a known tier", async () => {
    withIdempotency("evt_pi_bad_tier");

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_pi_bad_tier",
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: "pi_bad",
              metadata: { userId: "42", aiCreditTierId: "not_a_real_tier" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("logs and does not credit anything when aiCreditTierId is present but userId is missing", async () => {
    withIdempotency("evt_pi_no_user");

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_pi_no_user",
          type: "payment_intent.succeeded",
          data: {
            object: {
              id: "pi_no_user",
              metadata: { aiCreditTierId: "ai_credits_1m" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v3/webhooks/stripe: customer.subscription.created", () => {
  it("upgrades by userId metadata and grants the badge for a paid plan", async () => {
    withIdempotency("evt_sub_created_1");
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }); // UPDATE by userId
    mockQuery.mockResolvedValueOnce(badgeRow);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // recipient lookup (best-effort "subscription started" email)

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_created_1",
          type: "customer.subscription.created",
          data: {
            object: {
              id: "sub_1",
              customer: "cus_1",
              status: "active",
              metadata: { userId: "42", planId: "elite_supporter" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(5);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("WHERE id = $5");
    expect(params).toEqual([
      "elite_supporter",
      "sub_1",
      "active",
      "cus_1",
      42,
      null,
    ]);
  });

  it("BUG: when metadata is absent, the items[].price.product fallback compares Stripe's real product id against internal plan-name prefixes and silently resolves to 'free'", async () => {
    // getPlanFromProductId (lib/billing/products.ts) only recognizes ids that
    // literally start with "core_supporter" / "pro_supporter" /
    // "elite_supporter" -- the internal catalog id format used in
    // subscription.metadata.productId (set by our own checkout/create-session
    // route). A raw Stripe product id like "prod_XXXXXXXXXXXX" never matches
    // that prefix check, so this fallback can never actually recover the
    // paid plan; it always resolves to "free" instead. See
    // app/api/v3/webhooks/stripe/route.ts customer.subscription.created
    // handler's second fallback branch (items?.data?.[0]?.price?.product).
    withIdempotency("evt_sub_created_2");
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 55 }] }); // UPDATE by stripe_customer_id

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_created_2",
          type: "customer.subscription.created",
          data: {
            object: {
              id: "sub_2",
              customer: "cus_2",
              status: "active",
              metadata: {},
              items: { data: [{ price: { product: "prod_REAL_STRIPE_ID" } }] },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    // Only the customer-id UPDATE ran; no badge grant because plan
    // resolved (incorrectly) to "free".
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("WHERE stripe_customer_id = $4");
    expect(params[0]).toBe("free");
  });

  it("falls all the way through to the customers.retrieve + email fallback when neither userId nor customer-id matches", async () => {
    withIdempotency("evt_sub_created_3");
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // customer-id UPDATE, no match
    mockCustomerRetrieve.mockResolvedValue({ email: "found@example.com" });
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 88 }] }); // email UPDATE
    mockQuery.mockResolvedValueOnce(badgeRow);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // recipient lookup (best-effort "subscription started" email)

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_created_3",
          type: "customer.subscription.created",
          data: {
            object: {
              id: "sub_3",
              customer: "cus_3",
              status: "active",
              metadata: { planId: "pro_supporter" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockCustomerRetrieve).toHaveBeenCalledWith("cus_3");
    expect(mockQuery).toHaveBeenCalledTimes(6);
    const [emailSql, emailParams] = mockQuery.mock.calls[2];
    expect(emailSql).toContain("LOWER(email) = LOWER($5)");
    expect(emailParams[4]).toBe("found@example.com");
  });

  it("withholds BOTH the plan and the badge while the subscription is still incomplete", async () => {
    // payment_behavior: "default_incomplete" (app/actions/stripe.ts) makes
    // this the normal state of a subscription the instant it's created --
    // the client hasn't confirmed the PaymentElement yet, so no money has
    // actually moved. Writing the real plan here is the exact bug reported:
    // clicking a plan (before ever paying) immediately upgraded the
    // account's plan column, granting real feature limits with nothing
    // charged. The badge is a secondary, less severe instance of the same
    // bug and was the only thing an earlier fix caught here.
    withIdempotency("evt_sub_created_incomplete");
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }); // UPDATE by userId

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_created_incomplete",
          type: "customer.subscription.created",
          data: {
            object: {
              id: "sub_incomplete",
              customer: "cus_1",
              status: "incomplete",
              metadata: { userId: "42", planId: "elite_supporter" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    // Idempotency + UPDATE only -- no badge SELECT/INSERT.
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("plan = $1");
    expect(params[0]).toBe("free");
  });
});

describe("POST /api/v3/webhooks/stripe: customer.subscription.updated", () => {
  it("updates plan and status by stripe_customer_id, resolving the plan from subscription metadata", async () => {
    withIdempotency("evt_sub_updated_1");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // previous email/plan pre-read (best-effort change email)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_updated_1",
          type: "customer.subscription.updated",
          data: {
            object: {
              customer: "cus_5",
              status: "active",
              metadata: { productId: "elite_supporter_monthly" },
              items: { data: [{ price: { product: "prod_unrelated" } }] },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toContain("WHERE stripe_customer_id = $3");
    expect(params).toEqual(["elite_supporter", "active", "cus_5", null]);
  });

  it("persists the recurring interval so the admin MRR estimate can amortize yearly subs", async () => {
    withIdempotency("evt_sub_updated_yearly");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // previous email/plan pre-read
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_updated_yearly",
          type: "customer.subscription.updated",
          data: {
            object: {
              customer: "cus_5",
              status: "active",
              metadata: { productId: "elite_supporter_yearly" },
              items: {
                data: [
                  {
                    price: {
                      product: "prod_unrelated",
                      recurring: { interval: "year" },
                    },
                  },
                ],
              },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[2];
    expect(sql).toContain("billing_interval = $4");
    expect(params).toEqual(["elite_supporter", "active", "cus_5", "year"]);
  });

  it("grants the premium badge when an incomplete subscription transitions to active", async () => {
    // This is the transition that happens the moment the client confirms
    // the PaymentElement -- customer.subscription.created already fired
    // once (while still "incomplete", badge withheld), and this update
    // event is the only place the badge can be granted for that checkout.
    withIdempotency("evt_sub_updated_activates");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // previous email/plan pre-read
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }); // UPDATE ... RETURNING id
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge INSERT

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_updated_activates",
          type: "customer.subscription.updated",
          data: {
            object: {
              customer: "cus_5",
              status: "active",
              metadata: { productId: "elite_supporter_monthly" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(5);
    const [badgeInsertSql, badgeInsertParams] = mockQuery.mock.calls[4];
    expect(badgeInsertSql).toContain("user_badges");
    expect(badgeInsertParams).toEqual([42, 9]);
  });

  it("downgrades to free and revokes the badge when the subscription expires without ever being paid", async () => {
    // No customer.subscription.deleted event fires for this transition --
    // the 23-hour PaymentElement confirmation window just lapses and Stripe
    // moves the subscription straight to "incomplete_expired". This is the
    // only event that ever tells us to claw back access in that case.
    withIdempotency("evt_sub_updated_expires");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // previous email/plan pre-read
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }); // UPDATE ... RETURNING id
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge DELETE

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_updated_expires",
          type: "customer.subscription.updated",
          data: {
            object: {
              customer: "cus_5",
              status: "incomplete_expired",
              metadata: { productId: "elite_supporter_monthly" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(5);
    const [, updateParams] = mockQuery.mock.calls[2];
    expect(updateParams).toEqual(["free", "incomplete_expired", "cus_5", null]);
    const [badgeDeleteSql, badgeDeleteParams] = mockQuery.mock.calls[4];
    expect(badgeDeleteSql).toContain("DELETE FROM user_badges");
    expect(badgeDeleteParams).toEqual([42, 9]);
  });

  it("downgrades to free and revokes the badge for a plain still-incomplete subscription, not just incomplete_expired", async () => {
    // Regression test for the actual bug reported: this event isn't only
    // sent for incomplete_expired/unpaid -- Stripe can send
    // customer.subscription.updated while a subscription is still plain
    // "incomplete" (e.g. its items changed), and the earlier fix's
    // "neverPaid" check only covered incomplete_expired/unpaid, missing
    // this status entirely and writing the real plan anyway.
    withIdempotency("evt_sub_updated_still_incomplete");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // previous email/plan pre-read
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }); // UPDATE ... RETURNING id
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge DELETE

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_updated_still_incomplete",
          type: "customer.subscription.updated",
          data: {
            object: {
              customer: "cus_5",
              status: "incomplete",
              metadata: { productId: "elite_supporter_monthly" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const [, updateParams] = mockQuery.mock.calls[2];
    expect(updateParams).toEqual(["free", "incomplete", "cus_5", null]);
  });

  it("preserves the plan and badge during a past_due grace period instead of immediately downgrading", async () => {
    // past_due means a renewal payment failed on a subscription that WAS
    // already paying -- Stripe gives a multi-day retry window before
    // actually canceling, and app/actions/stripe.ts already treats
    // past_due as still-active for plan-switch purposes. Yanking access
    // over one failed card charge instead of during Stripe's own grace
    // period would be a worse outcome than this webhook staying quiet.
    withIdempotency("evt_sub_updated_past_due");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // previous email/plan pre-read
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 42 }] }); // UPDATE ... RETURNING id
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge INSERT

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_updated_past_due",
          type: "customer.subscription.updated",
          data: {
            object: {
              customer: "cus_5",
              status: "past_due",
              metadata: { productId: "elite_supporter_monthly" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const [, updateParams] = mockQuery.mock.calls[2];
    expect(updateParams).toEqual([
      "elite_supporter",
      "past_due",
      "cus_5",
      null,
    ]);
    const [badgeInsertSql] = mockQuery.mock.calls[4];
    expect(badgeInsertSql).toContain("user_badges");
  });

  it("skips the badge grant/revoke and log when the event is a no-op (plan and status already match)", async () => {
    // Regression test: Stripe fires customer.subscription.updated on ANY
    // field change to the subscription object, not just plan/status -- a
    // subscription stuck in a bad state (e.g. incomplete_expired) can keep
    // generating genuinely distinct events (each with its own event id, so
    // idempotency correctly lets each one through) that are still no-ops
    // from our side. The UPDATE's "IS DISTINCT FROM" guard means a no-op
    // event matches zero rows even though the customer exists.
    withIdempotency("evt_sub_updated_noop");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // previous email/plan pre-read
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // UPDATE matched nothing -- already up to date

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_updated_noop",
          type: "customer.subscription.updated",
          data: {
            object: {
              customer: "cus_5",
              status: "incomplete_expired",
              metadata: { productId: "elite_supporter_monthly" },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    // Idempotency INSERT, the best-effort previous-plan pre-read, and the
    // no-op UPDATE ran -- no badge SELECT/INSERT/DELETE, and no change email
    // (the UPDATE matched nothing).
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});

describe("POST /api/v3/webhooks/stripe: customer.subscription.deleted", () => {
  it("downgrades to free and revokes the premium badge", async () => {
    withIdempotency("evt_sub_deleted_1");
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 77 }] }); // UPDATE ... RETURNING id
    mockQuery.mockResolvedValueOnce(badgeRow); // badge SELECT
    mockQuery.mockResolvedValueOnce({ rows: [] }); // badge DELETE
    mockQuery.mockResolvedValueOnce({ rows: [] }); // recipient lookup (best-effort cancellation email)

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_deleted_1",
          type: "customer.subscription.deleted",
          data: { object: { customer: "cus_7" } },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(5);
    const [sql, params] = mockQuery.mock.calls[1];
    // billing: plan is now a CASE on role -- a staff account (whose real
    // paid subscription just ended) falls back to their granted
    // pro_supporter floor instead of free. See lib/billing/staff-plan.ts.
    expect(sql).toContain(
      "CASE WHEN role IN ('admin', 'moderator', 'support') THEN 'pro_supporter' ELSE 'free' END",
    );
    expect(sql).toContain("stripe_subscription_id = NULL");
    expect(params).toEqual(["cus_7"]);
    const [deleteSql, deleteParams] = mockQuery.mock.calls[3];
    expect(deleteSql).toContain("DELETE FROM user_badges");
    expect(deleteParams).toEqual([77, 9]);
  });

  it("does not attempt to revoke a badge when no user matched", async () => {
    withIdempotency("evt_sub_deleted_2");
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_sub_deleted_2",
          type: "customer.subscription.deleted",
          data: { object: { customer: "cus_missing" } },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/v3/webhooks/stripe: invoice events", () => {
  it("invoice.payment_succeeded marks the subscription active and records billing history", async () => {
    withIdempotency("evt_invoice_1");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE subscription_status
    mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT billing_history
    mockQuery.mockResolvedValueOnce({ rows: [] }); // recipient lookup (best-effort receipt email)

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_invoice_1",
          type: "invoice.payment_succeeded",
          data: {
            object: {
              id: "in_1",
              customer: "cus_2",
              amount_paid: 500,
              currency: "usd",
              description: "Pro Supporter subscription",
              invoice_pdf: "https://stripe.example/invoice.pdf",
              payment_intent: "pi_1",
              lines: { data: [{ description: "Pro Supporter" }] },
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(4);
    const [updateSql, updateParams] = mockQuery.mock.calls[1];
    expect(updateSql).toContain("subscription_status = 'active'");
    expect(updateParams).toEqual(["cus_2"]);
    const [historySql, historyParams] = mockQuery.mock.calls[2];
    expect(historySql).toContain("billing_history");
    expect(historyParams).toEqual([
      "in_1",
      "pi_1",
      500,
      "usd",
      "succeeded",
      "Pro Supporter subscription",
      "https://stripe.example/invoice.pdf",
      "cus_2",
    ]);
  });

  it("invoice.payment_succeeded still returns 200 when billing_history's table is missing (42P01), and logs it as expected via console.log, not console.error", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    withIdempotency("evt_invoice_2");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE subscription_status
    mockQuery.mockRejectedValueOnce(
      Object.assign(new Error("relation billing_history does not exist"), {
        code: "42P01",
      }),
    );
    mockQuery.mockResolvedValueOnce({ rows: [] }); // receipt recipient lookup (returns none)

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_invoice_2",
          type: "invoice.payment_succeeded",
          data: {
            object: {
              id: "in_2",
              customer: "cus_2",
              amount_paid: 100,
              currency: "usd",
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("billing_history table does not exist"),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("invoice.payment_succeeded still returns 200 but logs via console.error (so it reaches the admin Error Logs panel) when the billing_history insert fails for a reason OTHER than a missing table", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    withIdempotency("evt_invoice_2b");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE subscription_status
    mockQuery.mockRejectedValueOnce(
      Object.assign(
        new Error("duplicate key value violates unique constraint"),
        {
          code: "23505",
        },
      ),
    );
    mockQuery.mockResolvedValueOnce({ rows: [] }); // receipt recipient lookup (returns none)

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_invoice_2b",
          type: "invoice.payment_succeeded",
          data: {
            object: {
              id: "in_2b",
              customer: "cus_2",
              amount_paid: 100,
              currency: "usd",
            },
          },
        }),
      ),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Could not record billing history"),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it("invoice.payment_failed marks the subscription past_due", async () => {
    withIdempotency("evt_invoice_3");
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE subscription_status = past_due
    mockQuery.mockResolvedValueOnce({ rows: [] }); // recipient lookup (best-effort dunning email)

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_invoice_3",
          type: "invoice.payment_failed",
          data: { object: { customer: "cus_3" } },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toContain("subscription_status = 'past_due'");
    expect(params).toEqual(["cus_3"]);
  });
});

describe("POST /api/v3/webhooks/stripe: unhandled event types and failures", () => {
  it("acknowledges an event type it does not handle without writing anything else to the database", async () => {
    withIdempotency("evt_unknown_1");
    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_unknown_1",
          type: "customer.created",
          data: { object: {} },
        }),
      ),
    );
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when a handler's database write throws", async () => {
    withIdempotency("evt_fail_1");
    mockQuery.mockRejectedValueOnce(new Error("connection reset"));

    const res = await POST(
      signedRequest(
        JSON.stringify({
          id: "evt_fail_1",
          type: "invoice.payment_failed",
          data: { object: { customer: "cus_1" } },
        }),
      ),
    );
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("Webhook handler failed");
  });
});
