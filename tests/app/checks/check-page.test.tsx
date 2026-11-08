/**
 * The check, category and index pages rendered to HTML, because most of what
 * these guard is what ends up on the page rather than what one helper returns:
 * "every scan" was in three different places on an active-probes page, and
 * only one of them was the FAQ.
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CHECK_CATEGORY_LAST_MODIFIED } from "@/lib/config/check-stats.generated";
import {
  getCheckById,
  getChecksInCategory,
  getCategoryBlurb,
  type SeoCheck,
} from "@/lib/seo/checks-content";

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-nonce", "test-nonce"]]),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
// The real chrome reads auth context and the router, neither of which is what
// these tests are about.
vi.mock("@/components/landing/landing-nav", () => ({
  LandingNav: () => null,
}));
vi.mock("@/components/scanner/footer", () => ({ Footer: () => null }));
vi.mock("@/components/seo/scan-cta-form", () => ({
  ScanCtaForm: () => null,
}));
vi.mock("@/components/docs", () => ({
  CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
  InlineCode: ({ children }: { children: ReactNode }) => (
    <code>{children}</code>
  ),
}));

async function renderCheck(id: string): Promise<string> {
  const { default: CheckPage } = await import("@/app/checks/[id]/page");
  return renderToStaticMarkup(
    await CheckPage({ params: Promise.resolve({ id }) }),
  );
}

async function renderCategory(category: string): Promise<string> {
  const { default: CategoryPage } =
    await import("@/app/checks/category/[category]/page");
  return renderToStaticMarkup(
    await CategoryPage({ params: Promise.resolve({ category }) }),
  );
}

function jsonLd(html: string, type: string): Record<string, unknown> {
  for (const [, body] of html.matchAll(
    /<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/g,
  )) {
    const parsed = JSON.parse(body!) as Record<string, unknown>;
    if (parsed["@type"] === type) return parsed;
  }
  throw new Error(`no ${type} block`);
}

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const ACTIVE = getChecksInCategory("active-probes");
const ACTIVE_IDS = ACTIVE.map((c) => c.id);

describe("active-probes pages", () => {
  it("has probes to test", () => {
    expect(ACTIVE.length).toBeGreaterThan(0);
  });

  it.each(ACTIVE_IDS)("%s never says every scan", async (id) => {
    expect(textOf(await renderCheck(id))).not.toMatch(/every scan/i);
  });

  it.each(ACTIVE_IDS)("%s says when it actually runs", async (id) => {
    const text = textOf(await renderCheck(id));
    expect(text).toContain(
      "Only when active probing is switched on, and only for a domain you have verified",
    );
    expect(text).not.toContain("Detected automatically");
  });

  it("does not offer a paste-a-URL scan as the way to run one", async () => {
    const text = textOf(await renderCheck(ACTIVE_IDS[0]!));
    expect(text).not.toMatch(/hundreds more against a URL/);
    expect(text).toMatch(/opt-in/);
  });

  it("points at where a domain gets verified", async () => {
    expect(await renderCheck(ACTIVE_IDS[0]!)).toContain(
      'href="/attack-surface"',
    );
  });

  it("the call to action links straight there", async () => {
    const check = textOf(await renderCheck(ACTIVE_IDS[0]!));
    const category = textOf(await renderCategory("active-probes"));
    expect(check).toMatch(/Verify a domain/);
    expect(category).toMatch(/Verify a domain/);
  });

  it("the category page's call to action says the same", async () => {
    const text = textOf(await renderCategory("active-probes"));
    expect(text).toMatch(/opt-in/);
    expect(text).not.toMatch(/just paste a URL/);
    expect(text).not.toMatch(/every scan/i);
  });

  it("an ordinary check keeps the every-scan wording", async () => {
    const text = textOf(await renderCheck("cors-origin-reflection"));
    expect(text).toContain("It runs as part of every scan");
    expect(text).toContain("Detected automatically");
    expect(text).toMatch(/hundreds more against a URL/);
  });
});

describe("references", () => {
  const mitreUrl = (c: SeoCheck) =>
    `https://cwe.mitre.org/data/definitions/${c.cwe!.replace(/[^0-9]/g, "")}.html`;
  const withMitreRef = (c: SeoCheck) =>
    !!c.cwe && c.references.includes(mitreUrl(c));

  it("shows the MITRE link once, with its label", async () => {
    const check = getChecksInCategory("headers").find(withMitreRef)!;
    const html = await renderCheck(check.id);
    expect(html.split(`href="${mitreUrl(check)}"`).length - 1).toBe(1);
    expect(textOf(html)).toContain(`${check.cwe} at MITRE`);
  });

  it("keeps the other references", async () => {
    const check = getChecksInCategory("headers").find(
      (c) => withMitreRef(c) && c.references.length > 1,
    )!;
    const html = await renderCheck(check.id);
    for (const ref of check.references) {
      if (ref === mitreUrl(check)) continue;
      expect(html).toContain(`href="${ref}"`);
    }
  });
});

describe("explanation", () => {
  const ID = "cors-origin-reflection";

  it("skips generated filler even while the data still carries it", async () => {
    const real = getCheckById(ID)!;
    const original = real.explanation;
    real.explanation =
      "The `cors-origin-reflection` check verifies that the server does not expose the `cors` weakness in the headers category.";
    try {
      expect(await renderCheck(ID)).not.toContain("verifies that the server");
    } finally {
      real.explanation = original;
    }
  });

  it("still prints a real explanation", async () => {
    const real = getCheckById(ID)!;
    expect(real.explanation).not.toBe(real.description);
    expect(textOf(await renderCheck(ID))).toContain(
      real.explanation.slice(0, 30),
    );
  });
});

describe("structured data", () => {
  it("publishes the category's last-modified date as dateModified", async () => {
    const check = getCheckById("cors-origin-reflection")!;
    const article = jsonLd(await renderCheck(check.id), "TechArticle");
    expect(article.dateModified).toBe(
      CHECK_CATEGORY_LAST_MODIFIED[check.category],
    );
  });

  it("leaves dateModified off when no date is passed", async () => {
    const { TechArticleStructuredData } =
      await import("@/components/seo/structured-data");
    const html = renderToStaticMarkup(
      <TechArticleStructuredData title="t" description="d" path="/docs" />,
    );
    expect(jsonLd(html, "TechArticle")).not.toHaveProperty("dateModified");
  });
});

describe("related links", () => {
  it("links the neighbours rather than the top of the file", async () => {
    const members = getChecksInCategory("headers");
    const html = await renderCheck(members[40]!.id);
    expect(html).toContain(`href="/checks/${members[41]!.id}"`);
    expect(html).toContain(`href="/checks/${members[39]!.id}"`);
    expect(html).not.toContain(`href="/checks/${members[0]!.id}"`);
  });
});

describe("see-also blocks", () => {
  it("renders the merged family with links", async () => {
    const html = await renderCheck("document-write-usage");
    expect(textOf(html)).toContain("Reported as one finding");
    expect(html).toContain('href="/checks/document-write-sink"');
  });

  it("shows a member with no page as its id, not a dead link", async () => {
    const html = await renderCheck("csp-unsafe-eval-detected");
    expect(html).toContain("page-csp-unsafe-eval-effective");
    expect(html).not.toContain('href="/checks/page-csp-unsafe-eval-effective"');
  });

  it("does not claim a merge for a pair the engine reports separately", async () => {
    const text = textOf(await renderCheck("meta-referrer-unsafe"));
    expect(text).not.toContain("Reported as one finding");
    expect(text).toContain("Related, reported separately");
  });

  it("renders neither block for a check with no relations", async () => {
    const text = textOf(await renderCheck("cors-origin-reflection"));
    expect(text).not.toContain("Reported as one finding");
    expect(text).not.toContain("Related, reported separately");
  });
});

describe("category FAQ", () => {
  it.each(["ssl", "tls", "dns"] as const)(
    "%s no longer repeats the scan-scope blurb",
    async (category) => {
      expect(textOf(await renderCategory(category))).not.toContain(
        getCategoryBlurb(category),
      );
    },
  );
});

describe("/checks index", () => {
  async function renderIndex() {
    const { default: ChecksIndexPage } = await import("@/app/checks/page");
    return textOf(renderToStaticMarkup(await ChecksIndexPage()));
  }

  it("drops the reason that was not true", async () => {
    const text = await renderIndex();
    expect(text).not.toMatch(/several pages at once/i);
    expect(text).not.toMatch(/multi-page analysis/i);
  });

  it("says what the rest are instead", async () => {
    const text = await renderIndex();
    expect(text).toMatch(/report under their own ids/);
    expect(text).toMatch(/page yet/);
  });
});
