import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CREDIT_KINDS,
  CREDIT_KIND_ORDER,
  bestRateTierId,
  formatCount,
  formatUnits,
  formatUsd,
  unitsPerDollar,
  type CreditKind,
} from "@/components/billing/credit-kinds";
import { AI_CREDIT_TIERS } from "@/lib/billing/ai-credit-catalog";
import { GITHUB_CREDIT_TIERS } from "@/lib/billing/github-credit-catalog";
import { BROWSERBASE_CREDIT_TIERS } from "@/lib/billing/browserbase-credit-catalog";

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

describe("formatUsd", () => {
  it("prints a whole-dollar price without cents", () => {
    expect(formatUsd(1000)).toBe("$10");
    expect(formatUsd(500)).toBe("$5");
  });

  /**
   * The regression this exists for: all three credit pages printed prices with
   * `.toFixed(0)`, so the first tier priced at anything other than a whole
   * dollar would have shown one number on the page and charged another through
   * Stripe.
   */
  it("keeps the cents on a price that has them", () => {
    expect(formatUsd(1250)).toBe("$12.50");
    expect(formatUsd(99)).toBe("$0.99");
    expect(formatUsd(1)).toBe("$0.01");
  });
});

describe("formatCount", () => {
  it("groups digits the same way whatever the ambient locale is", () => {
    // Pinned to en-US on purpose: these render on the server and hydrate in
    // the browser, and a locale-dependent separator is a hydration mismatch.
    expect(formatCount(1_000_000)).toBe("1,000,000");
    expect(formatCount(0)).toBe("0");
  });

  it("shows a fraction only when there is one", () => {
    // Live-browser minutes come from seconds, so 90s is a real 1.5.
    expect(formatCount(1.5)).toBe("1.5");
    expect(formatCount(3)).toBe("3");
  });
});

describe("formatUnits", () => {
  it("agrees with itself about singular and plural", () => {
    expect(formatUnits(CREDIT_KINDS.browser, 1)).toBe("1 minute");
    expect(formatUnits(CREDIT_KINDS.browser, 30)).toBe("30 minutes");
    expect(formatUnits(CREDIT_KINDS.ai, 1_000_000)).toBe("1,000,000 tokens");
  });
});

describe("bestRateTierId", () => {
  it("names the rung with the best rate on every real ladder", () => {
    for (const kindId of CREDIT_KIND_ORDER) {
      const kind = CREDIT_KINDS[kindId];
      const best = kind.tiers.find((t) => t.id === bestRateTierId(kind))!;
      for (const tier of kind.tiers) {
        expect(unitsPerDollar(best)).toBeGreaterThanOrEqual(
          unitsPerDollar(tier),
        );
      }
    }
  });

  /**
   * The three pages this replaces marked "best value" by taking the LAST entry
   * in the catalog, which is only the same thing while the catalog stays
   * sorted. An unsorted ladder used to promote the wrong tier silently.
   */
  it("does not just take the last tier", () => {
    const unsorted: CreditKind = {
      ...CREDIT_KINDS.ai,
      tiers: [
        { id: "cheap_bad", amount: 100, priceInCents: 100 },
        { id: "generous", amount: 1000, priceInCents: 100 },
        { id: "last_but_worst", amount: 200, priceInCents: 500 },
      ],
    };
    expect(bestRateTierId(unsorted)).toBe("generous");
  });
});

describe("the kind table mirrors the catalogs it normalises", () => {
  it("carries the AI ladder verbatim", () => {
    expect(CREDIT_KINDS.ai.tiers).toEqual(
      AI_CREDIT_TIERS.map((t) => ({
        id: t.id,
        amount: t.tokens,
        priceInCents: t.priceInCents,
      })),
    );
  });

  it("carries the GitHub ladder verbatim", () => {
    expect(CREDIT_KINDS.github.tiers).toEqual(
      GITHUB_CREDIT_TIERS.map((t) => ({
        id: t.id,
        amount: t.tokens,
        priceInCents: t.priceInCents,
      })),
    );
  });

  it("carries the live-browser ladder verbatim, in minutes", () => {
    expect(CREDIT_KINDS.browser.tiers).toEqual(
      BROWSERBASE_CREDIT_TIERS.map((t) => ({
        id: t.id,
        amount: t.minutes,
        priceInCents: t.priceInCents,
      })),
    );
  });

  /**
   * /credits tells the reader in so many words that AI and GitHub credits are
   * priced identically, tier for tier. That sentence is only true while the two
   * catalogs agree, and they are separate files that nothing else forces to
   * stay in step, so this is the assertion that stops the page from lying.
   */
  it("keeps the AI and GitHub ladders identical, which /credits states as fact", () => {
    expect(CREDIT_KINDS.github.tiers.map((t) => t.amount)).toEqual(
      CREDIT_KINDS.ai.tiers.map((t) => t.amount),
    );
    expect(CREDIT_KINDS.github.tiers.map((t) => t.priceInCents)).toEqual(
      CREDIT_KINDS.ai.tiers.map((t) => t.priceInCents),
    );
    expect(read("components/billing/credits-overview.tsx")).toContain(
      "priced identically",
    );
  });
});

describe("credit route shape", () => {
  it("gives every kind its own named top-level page", () => {
    for (const kindId of CREDIT_KIND_ORDER) {
      const kind = CREDIT_KINDS[kindId];
      expect(kind.path).toMatch(/^\/[a-z-]+$/);
      expect(
        fs.existsSync(path.join(ROOT, "app", kind.path.slice(1), "page.tsx")),
        `${kind.path} has a page`,
      ).toBe(true);
    }
    expect(fs.existsSync(path.join(ROOT, "app/credits/page.tsx"))).toBe(true);
  });

  /**
   * The old URLs are in bookmarks, in Stripe receipts and in the docs. They
   * also have to keep existing as real routes: /checkout/[productId] is a
   * dynamic segment, so deleting /checkout/credits would not 404, it would
   * render the subscription checkout's "That plan does not exist".
   */
  it.each([
    ["app/checkout/credits/page.tsx", "ai"],
    ["app/checkout/github-credits/page.tsx", "github"],
    ["app/checkout/browser-credits/page.tsx", "browser"],
  ] as const)("%s permanently redirects to the new page", (rel, kindId) => {
    const source = read(rel);
    expect(source).toContain("permanentRedirect");
    expect(source).toContain(`CREDIT_KINDS.${kindId}.path`);
  });

  /** /checkout/success reads ?kind= back off a redirect-based payment method,
   *  so these three strings have to keep matching what it knows about. */
  it("sends a ?kind= that the success page still recognises", () => {
    const success = read("app/checkout/success/checkout-success-content.tsx");
    for (const kindId of CREDIT_KIND_ORDER) {
      expect(success).toContain(`"${CREDIT_KINDS[kindId].successKind}"`);
    }
  });
});
