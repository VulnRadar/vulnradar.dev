import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * There is one way to end a Stripe subscription immediately:
 * cancelSubscriptionNow in lib/billing/cancel-subscription.ts, which never
 * prorates and never invoices.
 *
 * There were two (sec-money-6). POST /billing called subscriptions.cancel,
 * while the route the Billing tab actually calls sent update({cancel_at: now}),
 * which Stripe runs under the default proration setting. The tab's "Cancel
 * immediately, no refund" therefore credited the unused time back, and the two
 * endpoints gave the same customer different money outcomes. The duplicate is
 * deleted (owner decision D8) and this keeps a second one from growing back.
 *
 * Found by content, not by path, so the 4.0.0 route move cannot walk the
 * implementation out from under it.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const HELPER = "lib/billing/cancel-subscription.ts";

/**
 * Direct calls that are not the UI's cancel, each listed by file with the
 * number of calls and why. Exact counts, so a second call in one of these
 * files fails too. Routing one of them through cancelSubscriptionNow means
 * deleting its entry here.
 */
const LISTED: Record<string, { calls: number; why: string }> = {
  "app/api/v3/webhooks/stripe/route.ts": {
    calls: 1,
    why:
      "The two-strike dunning cancel on invoice.payment_failed. It runs in a " +
      "webhook with no user session, and sends what the UI path does not: " +
      "cancellation_details.comment (TWO_STRIKE_CANCEL_COMMENT) and the " +
      "idempotency key two-strike-cancel-<subscription id>, so a redelivered " +
      "event cannot cancel twice. It already passes prorate: false and " +
      "invoice_now: false.",
  },
  "lib/billing/cancel-before-deletion.ts": {
    calls: 1,
    why:
      "Account deletion ending every live subscription before the row goes. " +
      "It passes no options, and Stripe's defaults for cancel are already no " +
      "proration and no invoice, so the money outcome matches. Outside this " +
      "change's files; routing it through the helper is listed for the " +
      "integrator.",
  },
};

const DIRECT_CANCEL = /\bsubscriptions\s*\.\s*(?:cancel|del)\s*\(/g;
// A cancel scheduled through update(). `cancel_at_period_end` is the period-end
// cancel and is fine; a bare `cancel_at:` is the immediate one that prorated.
const SCHEDULED_CANCEL = /\bcancel_at\s*:/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = ["app", "lib", "components"].flatMap((d) =>
  sourceFiles(path.join(ROOT, d)),
);
const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join("/");
// Read once. Only files that mention cancelling at all are kept, which is a
// handful out of a few thousand.
const sources = new Map<string, string>();
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (text.includes("cancel")) sources.set(rel(file), text);
}

function count(re: RegExp): Map<string, number> {
  const hits = new Map<string, number>();
  for (const [file, text] of sources) {
    const n = text.match(re)?.length ?? 0;
    if (n) hits.set(file, n);
  }
  return hits;
}

describe("ending a subscription immediately", () => {
  it("walks enough of the tree to mean something", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("has one implementation, plus only the calls listed here with their reason", () => {
    const hits = count(DIRECT_CANCEL);
    expect(hits.get(HELPER), `${HELPER} is the implementation`).toBe(1);
    hits.delete(HELPER);

    const expected = Object.fromEntries(
      Object.entries(LISTED).map(([file, { calls }]) => [file, calls]),
    );
    expect(
      Object.fromEntries(hits),
      "Call cancelSubscriptionNow from lib/billing/cancel-subscription.ts " +
        "instead of stripe.subscriptions.cancel. A call that genuinely cannot " +
        "go through it is added to LISTED with the reason.",
    ).toEqual(expected);
  });

  it("gives every listed call a reason", () => {
    for (const [file, { why }] of Object.entries(LISTED)) {
      expect(why.length, file).toBeGreaterThan(40);
    }
  });

  it("never schedules an immediate cancel through update({cancel_at})", () => {
    expect([...count(SCHEDULED_CANCEL).keys()]).toEqual([]);
  });

  it("is what the Billing tab's cancel route calls", () => {
    const routes = [...sources.keys()].filter((f) =>
      f.endsWith("billing/subscription/cancel/route.ts"),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(sources.get(route), route).toContain("cancelSubscriptionNow(");
    }
  });
});
