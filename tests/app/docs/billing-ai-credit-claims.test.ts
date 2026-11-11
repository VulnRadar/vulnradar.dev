import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * What spends a purchased AI credit, and what a plan switch charges, said the
 * same way on /docs/billing, /docs/ai and the Billing tab. They disagreed
 * (ux-copy-19): the tab and the summary route said summaries were unmetered
 * while /docs/billing said they spent the allowance and the credits. Only
 * finding verification spends credits (lib/billing/ai-usage.ts recordAiTokens
 * charges only when a caller asks, and only verification does).
 */
const prose = (file: string) =>
  readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{" "\}/g, " ")
    .replace(/\s+/g, " ");

const billing = prose("app/docs/billing/page.tsx");
const ai = prose("app/docs/ai/page.tsx");

describe("/docs/billing", () => {
  it("says only verification spends AI credits", () => {
    expect(billing).toContain(
      "AI finding verification, once the window allowance is gone. Chat and scan summaries do not spend credits.",
    );
    expect(billing).not.toContain(
      "AI finding verification and AI scan summaries",
    );
  });

  it("says an upgrade is charged now and a downgrade is not", () => {
    // sec-money-1: an upgrade is invoiced at once with pending_if_incomplete,
    // a downgrade keeps create_prorations.
    expect(billing).toContain(
      "charges the prorated difference to that card straight away",
    );
    expect(billing).toContain(
      "if it is declined, you stay on the plan you had",
    );
    expect(billing).toContain("A lower plan charges nothing at the time");
  });

  it("still says cancelling immediately refunds nothing", () => {
    // sec-money-6: the immediate cancel now really does not prorate.
    expect(billing).toContain("the remainder of the period is not refunded");
  });
});

describe("/docs/ai", () => {
  it("no longer says a summary can spend purchased credits", () => {
    expect(ai).not.toContain("can draw down a purchased AI credit balance");
    expect(ai).toContain(
      "like chat it never spends a purchased AI credit balance",
    );
  });

  it("names verification as the only feature that spends the balance", () => {
    expect(ai).not.toContain(
      "Vera chat is the one AI feature that never spends it",
    );
    expect(ai).toContain(
      "Finding verification is the only feature that spends it",
    );
  });
});
