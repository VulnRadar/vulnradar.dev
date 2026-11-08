/**
 * Every number the public marketing surface publishes has to be read from the
 * source the server enforces, not typed into the copy.
 *
 * This suite exists because the same defect keeps shipping: a figure is written
 * into a sentence, the config behind it moves, and the page goes on advertising
 * the old one. The FAQ that rendered "keeps results for -1 days" is the famous
 * one; the plan cards that promised "30-day" and "90-day" scan history when
 * every plan had unlimited retention (AUDIT-014#mkt-08) were the same bug, and
 * three more copies of that exact claim were still live on /pricing afterwards.
 *
 * Source-text assertions, same reason as tests/components/shared/
 * social-links.test.ts: this config runs a plain node environment with no jsdom,
 * so a `.tsx` cannot be rendered. What can be checked is that the literal is not
 * in the file and that the derived value equals the catalog.
 */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PLANS, getPaidPlans, getFreePlan } from "@/lib/billing/plans";
import { BILLING_HISTORY_RETENTION } from "@/lib/config/client-constants";
import { SEO_TWITTER_HANDLE, SOCIAL_LINKS } from "@/lib/config/constants";
import {
  EVERY_PLAN_KEEPS_HISTORY,
  WHAT_PAYING_BUYS,
} from "@/components/pricing/what-paying-buys";
import { BULK_URLS_FREE, BULK_URLS_TOP } from "@/components/landing/plan-facts";
import { CHEAPEST_PAID } from "@/lib/seo/alternatives";

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Copy only: comment lines are where the old wording is deliberately quoted. */
function copyOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("//") &&
        !trimmed.startsWith("*") &&
        !trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

describe("retention claims", () => {
  it("agrees with the retention config on every plan", () => {
    const unlimited = PLANS.every(
      (plan) =>
        BILLING_HISTORY_RETENTION[
          plan.id as keyof typeof BILLING_HISTORY_RETENTION
        ] === -1,
    );
    expect(EVERY_PLAN_KEEPS_HISTORY).toBe(unlimited);
  });

  it("never sells a longer history while every plan keeps it forever", () => {
    if (!EVERY_PLAN_KEEPS_HISTORY) return;
    expect(WHAT_PAYING_BUYS.toLowerCase()).not.toContain("history");
    expect(WHAT_PAYING_BUYS.toLowerCase()).not.toContain("retention");
  });

  it("leaves no copy on the pricing surface promising it anyway", () => {
    if (!EVERY_PLAN_KEEPS_HISTORY) return;
    // All three said it at once, in the hero, in the billing-off explainer, and
    // in the pricing-model FAQ that app/pricing/layout.tsx publishes as FAQPage
    // JSON-LD. Fixing one and leaving the siblings is how it survived the first
    // time.
    for (const file of [
      "components/pricing/pricing-hero.tsx",
      "components/pricing/pricing-faq.tsx",
      "app/pricing/page.tsx",
      "app/pricing/pricing-model-faq.ts",
      "app/landing/page.tsx",
    ]) {
      const copy = copyOnly(read(file)).toLowerCase();
      expect(copy, `${file} promises a longer history`).not.toContain(
        "longer history",
      );
      expect(copy, `${file} sells history retention`).not.toContain(
        "history retention",
      );
    }
  });
});

describe("bulk scan claim", () => {
  it("reads both ends from the plan catalog", () => {
    expect(BULK_URLS_FREE).toBe(getFreePlan().limits.bulkScanUrls);
    expect(BULK_URLS_TOP).toBe(
      Math.max(...PLANS.map((plan) => plan.limits.bulkScanUrls)),
    );
  });

  it("does not state the top plan's cap as if it applied to everyone", () => {
    // app/api/v3/scan/bulk/route.ts checks the caller's own bulkScanUrls on top
    // of the deployment-wide MAX_URLS_BULK, so "up to 100 URLs per request" was
    // a 403 for every reader not on the top plan.
    for (const file of [
      "components/landing/landing-api-example.tsx",
      "components/landing/landing-use-cases.tsx",
    ]) {
      const copy = copyOnly(read(file));
      expect(copy, `${file} types the bulk cap in`).not.toMatch(
        new RegExp(`${BULK_URLS_TOP}\\s+URLs`),
      );
      expect(copy).toContain("BULK_URLS_");
    }
  });
});

describe("prices", () => {
  const paid = getPaidPlans().map((plan) => plan.priceInCents / 100);

  it("names every catalog price on the comparison pages, and none of its own", () => {
    const source = read("lib/seo/alternatives.ts");
    const copy = copyOnly(source);
    // A dollar figure written as a literal is one checkout price change away
    // from being a lie on four pages at once.
    expect(copy.match(/\$\d/g), "hardcoded price in alternatives copy").toBe(
      null,
    );
    for (const price of paid) {
      expect(source, `catalog price ${price} unreferenced`).toContain(
        "getPaidPlans",
      );
    }
  });

  it("derives the /alternatives lede's price instead of writing it out", () => {
    const source = read("app/alternatives/page.tsx");
    expect(copyOnly(source)).not.toMatch(/\$\d/);
    expect(source).toContain("CHEAPEST_PAID");
    expect(CHEAPEST_PAID).toBe(Math.min(...paid));
  });

  it("derives the /pricing title's price instead of writing it out", () => {
    const source = read("app/pricing/layout.tsx");
    expect(copyOnly(source)).not.toMatch(/From \$\d/);
    expect(source).toContain("CHEAPEST_PAID");
  });
});

describe("self-audit fact on the landing page", () => {
  it("states no count of its own and links the directory that proves it", () => {
    // The number sat in the copy by hand. It cannot be read from
    // audits/registry.json either: .dockerignore keeps audits/ out of the build
    // context, so importing it would break every image build.
    const source = read("components/landing/landing-open-source.tsx");
    const fact = source.match(/label:\s*"Self-audits",\s*value:\s*"([^"]+)"/);
    expect(fact, "the Self-audits fact changed shape").not.toBeNull();
    expect(fact![1]).not.toMatch(/\d/);
    expect(source).toContain("/tree/main/audits");
  });

  it("does not import from a directory the Docker build never sees", () => {
    expect(read(".dockerignore")).toMatch(/^audits$/m);
    expect(read("components/landing/landing-open-source.tsx")).not.toMatch(
      /from\s+"[^"]*audits\//,
    );
  });
});

describe("scan duration", () => {
  it("is not promised on the landing page", () => {
    // Nothing measures it, and the slow targets are the ones a visitor is
    // likely to try first. The report states how long a scan really took.
    for (const file of [
      "app/landing/page.tsx",
      "components/landing/landing-hero.tsx",
      "components/landing/landing-how-it-works.tsx",
    ]) {
      const copy = copyOnly(read(file)).replace(/\s+/g, " ");
      expect(copy, file).not.toMatch(/under (3|three) seconds/i);
      expect(copy, file).not.toContain("<3s");
    }
  });
});

describe("signup description", () => {
  const copy = copyOnly(read("app/signup/layout.tsx"));

  it("reads the free allowance from the plan limits", () => {
    // The negative sign is the sentinel being handled, not a typed-in number.
    expect(copy).not.toMatch(/(?<!-)\b\d+ scans a day/);
    expect(copy).toContain("BILLING_PLAN_LIMITS.free");
  });

  it("stays a template literal the features-knowledge compiler can read", () => {
    // scripts/knowledge/compile-features-knowledge.mjs takes the text straight
    // after `description:` and resolves `${BILLING_PLAN_LIMITS.free}`. A local
    // holding a ternary would resolve to nothing and drop the route's summary.
    expect(copy).toMatch(
      /description:\s*`Create a free \$\{APP_NAME\} account\. \$\{BILLING_PLAN_LIMITS\.free\} scans a day/,
    );
  });

  async function descriptionFor(free: number): Promise<string> {
    vi.resetModules();
    vi.doMock("@/lib/config/constants", async (original) => ({
      ...(await original<typeof import("@/lib/config/constants")>()),
      BILLING_PLAN_LIMITS: { free },
    }));
    const { metadata } = await import("@/app/signup/layout");
    vi.doUnmock("@/lib/config/constants");
    return String(metadata.description);
  }

  it("states the configured number", async () => {
    expect(await descriptionFor(40)).toContain(" 40 scans a day,");
  });

  it("never publishes the unlimited sentinel as a number", async () => {
    const description = await descriptionFor(-1);
    expect(description).not.toContain("-1");
    expect(description).toContain("Unlimited scans,");
  });
});

/**
 * Structured data has to describe what the page actually shows.
 *
 * Six page families built an FAQ array and handed it to FaqStructuredData; only
 * /alternatives/<x> rendered it, so roughly 770 pages published an FAQPage
 * entity whose questions appeared nowhere on the page. Google's policy requires
 * FAQ content to be visible, and this repo already knew that in two other
 * places (app/pricing/layout.tsx picks the FAQ matching whichever branch it
 * rendered; HowToStructuredData's doc comment warns against exactly this).
 */
describe("FAQ structured data", () => {
  function pagesUnder(dir: string): string[] {
    const found: string[] = [];
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "page.tsx" || entry.name === "layout.tsx") {
          found.push(path.relative(ROOT, full).split(path.sep).join("/"));
        }
      }
    };
    walk(path.join(ROOT, dir));
    return found;
  }

  it("is only emitted by a page that also renders the questions", () => {
    // Rendering can be the shared SeoFaq section, a local .map over the same
    // array, or (on /pricing and /landing) a dedicated FAQ component.
    const RENDERERS =
      /<SeoFaq|\.map\(\((?:item|faq)\b|<PricingFaq|<LandingFaq|PRICING_FAQ|PRICING_MODEL_FAQ/;
    const invisible = pagesUnder("app")
      .filter((file) => {
        const source = read(file);
        return source.includes("<FaqStructuredData") && !RENDERERS.test(source);
      })
      .sort();
    expect(
      invisible,
      "these publish FAQPage markup for content the visitor never sees",
    ).toEqual([]);
  });
});

describe("twitter:site", () => {
  it("attributes the X account the rest of the site already claims", () => {
    const profile = SOCIAL_LINKS.find((link) => link.id === "x");
    if (!profile) {
      expect(SEO_TWITTER_HANDLE).toBe("");
      return;
    }
    // The card tag and the sameAs entry have to be the same account, or the
    // structured data and the social card attribute the site to two identities.
    expect(SEO_TWITTER_HANDLE).toMatch(/^@[^/]+$/);
    expect(profile.url).toContain(SEO_TWITTER_HANDLE.slice(1));
  });
});
