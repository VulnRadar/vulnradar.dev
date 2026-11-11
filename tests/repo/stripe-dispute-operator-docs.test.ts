import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CHANGELOG } from "@/lib/changelog/data";

/**
 * The won-dispute credit restore depends on charge.dispute.closed reaching the
 * webhook. An operator only receives it if they add it to the existing
 * endpoint in the Stripe dashboard: the setup route registers events while
 * STRIPE_WEBHOOK_SECRET is unset and answers without calling Stripe after
 * that. The changelog once told operators to "run the admin webhook setup
 * again", which does nothing on any instance that takes payments.
 */

const ROOT = path.resolve(__dirname, "../..");

function entry() {
  for (const release of CHANGELOG) {
    for (const change of release.changes) {
      if (change.label === "Stripe Webhooks Need the Dispute Closed Event")
        return change;
    }
  }
  return undefined;
}

describe("charge.dispute.closed operator instructions", () => {
  it("the changelog sends operators to the Stripe dashboard, not the setup route", () => {
    const change = entry();
    expect(change).toBeDefined();
    expect(change!.desc).toMatch(/Stripe dashboard/);
    expect(change!.desc).toMatch(/Disputes write/);
    expect(change!.desc).not.toMatch(
      /by running the admin webhook setup again/,
    );
  });

  it("the self-hosting security checklist names the Disputes permission", () => {
    const page = readFileSync(
      path.join(ROOT, "app/docs/self-hosting/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/restricted keys[^"]*Disputes write/);
  });
});
