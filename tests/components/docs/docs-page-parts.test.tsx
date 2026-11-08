import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/docs/teams",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DocsSection } from "@/components/docs/docs-section";
import { DocsSteps, DocsStep } from "@/components/docs/docs-steps";
import { DocsUiPath } from "@/components/docs/docs-ui-path";
import {
  DocsCreditName,
  DocsLimitsTable,
  DocsPlanTag,
  DocsPlanValue,
} from "@/components/docs/docs-plan-values";
import {
  DocsDetails,
  DocsNextSteps,
  DocsPrerequisites,
} from "@/components/docs/docs-page-blocks";
import { DocsRelated } from "@/components/docs/docs-related";
import { DocsContext } from "@/components/docs/docs-context";
import { docsEditUrl, docsReportUrl } from "@/components/docs/docs-page-footer";
import { Callout } from "@/components/shared/callout";
import { PLANS } from "@/lib/billing/catalog";
import { CREDIT_KINDS } from "@/components/billing/credit-kinds";
import { APP_REPO } from "@/lib/config/client-constants";
import { limitLabel } from "@/lib/ui/plan-labels";

const html = renderToStaticMarkup;
/** Rendered text only. Walks the markup, so no half-tag can be left behind. */
function text(markup: string): string {
  let out = "";
  let inTag = false;
  for (const ch of markup) {
    if (ch === "<") inTag = true;
    else if (ch === ">" && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
}

describe("DocsSteps", () => {
  it("takes children with an h3 and a linkable id", () => {
    const out = html(
      <DocsSteps>
        <DocsStep title="Open the scanner">
          <a href="/x">a link in the body</a>
        </DocsStep>
      </DocsSteps>,
    );
    expect(out).toContain("<ol");
    expect(out).toMatch(/<h3 id="open-the-scanner"/);
    expect(out).toContain('<a href="/x">a link in the body</a>');
  });

  it("uses an explicit id when given one", () => {
    expect(
      html(
        <DocsSteps>
          <DocsStep id="step-3" title="Third">
            x
          </DocsStep>
        </DocsSteps>,
      ),
    ).toMatch(/<h3 id="step-3"/);
  });

  it("still takes the old steps prop", () => {
    const out = html(
      <DocsSteps
        steps={[{ step: 1, title: "First", description: "Do the thing." }]}
      />,
    );
    expect(out).toContain("First");
    expect(out).toContain("Do the thing.");
  });

  it("numbers from the list, in a w-5 column, and un-indents code on a phone", () => {
    const out = html(
      <DocsSteps>
        <DocsStep title="One">x</DocsStep>
      </DocsSteps>,
    );
    expect(out).toContain("w-5");
    expect(out).toContain("[counter-reset:docs-step]");
    expect(out).toContain("[&amp;_figure]:-ml-12");
  });
});

describe("lists directly inside a DocsSection", () => {
  // The section's prose rules include [&>ol] and [&>ul], whose indent and 8px
  // gap win over a plain utility on the list, so these have to be important.
  it("DocsSteps keeps its own spacing, with no prose indent or measure", () => {
    const out = html(
      <DocsSection id="s" title="S">
        <DocsSteps>
          <DocsStep title="One">x</DocsStep>
        </DocsSteps>
      </DocsSection>,
    );
    const ol = out.match(/<ol class="([^"]*)"/)![1];
    expect(ol.split(" ")).toEqual(
      expect.arrayContaining(["space-y-8!", "pl-0!", "max-w-none!"]),
    );
  });

  it("DocsNextSteps is not a bulleted prose list", () => {
    const out = html(
      <DocsSection id="s" title="S">
        <DocsNextSteps steps={[{ href: "/a", label: "A", reason: "Why" }]} />
      </DocsSection>,
    );
    const ul = out.match(/<ul class="([^"]*)"/)![1];
    expect(ul.split(" ")).toEqual(
      expect.arrayContaining(["list-none!", "pl-0!", "space-y-3!"]),
    );
  });
});

describe("DocsUiPath", () => {
  it("is a chip inside a paragraph, not a prose link", () => {
    const out = html(<DocsUiPath to="profile.general" />);
    expect(out).toContain("text-foreground!");
    expect(out).toContain("no-underline!");
  });

  it("renders the path as one deep link", () => {
    const out = html(<DocsUiPath to="profile.developer.apiKeys" />);
    expect(text(out)).toBe("Profile&gt;Developer&gt;API Keys");
    expect(out).toContain('href="/profile?tab=developer&amp;dtab=api-keys"');
  });

  it("wraps only at the separators and is a 24px target", () => {
    const out = html(<DocsUiPath to="profile.developer.apiKeys" />);
    expect(out).toContain("whitespace-nowrap");
    expect(out).toContain("min-h-6");
    expect(out).toContain("rounded-md");
  });
});

describe("plan and credit values", () => {
  const pro = PLANS.find((plan) => plan.id === "pro_supporter")!;

  it("reads a limit from the catalog", () => {
    expect(text(html(<DocsPlanValue plan="pro" limit="dailyScans" />))).toBe(
      limitLabel(pro.limits.dailyScans),
    );
  });

  it("accepts the real plan id as well", () => {
    expect(
      text(html(<DocsPlanValue plan="pro_supporter" limit="dailyScans" />)),
    ).toBe(limitLabel(pro.limits.dailyScans));
  });

  it("tags the cheapest plan with a feature, in the control radius", () => {
    const out = html(<DocsPlanTag min="pro" />);
    expect(text(out)).toBe(`${pro.name} and up`);
    expect(out).toContain("rounded-md");
    expect(text(html(<DocsPlanTag min="free" />))).toBe("All plans");
  });

  it("names a credit kind from CREDIT_KINDS", () => {
    expect(html(<DocsCreditName kind="ai" />)).toBe(CREDIT_KINDS.ai.name);
  });

  it("renders a limits table with one column per plan", () => {
    const out = html(
      <DocsLimitsTable rows={[{ label: "Scans", limit: "dailyScans" }]} />,
    );
    for (const plan of PLANS) expect(out).toContain(plan.name);
    expect(out).toContain("sm:hidden");
  });

  it("lets a row override a cell", () => {
    const out = html(
      <DocsLimitsTable
        rows={[
          {
            label: "Reviews",
            limit: "githubReviewTokensPerWindow",
            cells: { free: "One trial" },
          },
        ]}
      />,
    );
    expect(out).toContain("One trial");
  });
});

describe("limitLabel", () => {
  it("reads the sentinels and formats the rest", () => {
    expect(limitLabel(-1)).toBe("Unlimited");
    expect(limitLabel(0)).toBe("Not included");
    expect(limitLabel(25000)).toBe("25,000");
  });
});

describe("page blocks", () => {
  it("DocsDetails is a native details with a 44px summary", () => {
    const out = html(<DocsDetails summary="Under the hood">x</DocsDetails>);
    expect(out).toContain("<details");
    expect(out).toContain("min-h-11");
  });

  it("DocsPrerequisites is a definition list of what was given", () => {
    const out = html(<DocsPrerequisites time="2 minutes" costs="1 scan" />);
    expect(out).toContain("<dl");
    expect(out).toContain(">Time</dt>");
    expect(out).toContain(">Costs</dt>");
    expect(out).not.toContain("You need");
  });

  it("DocsNextSteps shows each link with its reason, at most three", () => {
    const steps = [1, 2, 3, 4].map((n) => ({
      href: `/docs/${n}`,
      label: `Page ${n}`,
      reason: `Because ${n}`,
    }));
    const out = html(<DocsNextSteps steps={steps} />);
    expect(out).toContain("Because 1");
    expect(out).toContain("Page 3");
    expect(out).not.toContain("Page 4");
  });
});

describe("DocsRelated", () => {
  const withToc = (children: ReactNode, toc = [{ id: "a", label: "A" }]) => (
    <DocsContext.Provider
      value={{
        activeSection: "",
        setActiveSection: () => {},
        tocItems: toc,
        openSearch: () => {},
      }}
    >
      {children}
    </DocsContext.Provider>
  );

  it("is a definition list of the rows it was given", () => {
    const out = html(withToc(<DocsRelated app="Teams" api="No public API" />));
    expect(out).toContain("<dl");
    expect(out).toContain(">In the app</dt>");
    expect(out).toContain(">In the API</dt>");
    expect(out).not.toContain("For self-hosters");
  });

  it("gives way to the rail where the rail exists", () => {
    expect(html(withToc(<DocsRelated app="x" />))).toContain("xl:hidden");
    expect(html(withToc(<DocsRelated app="x" />, []))).not.toContain(
      "xl:hidden",
    );
  });

  it("renders nothing with nothing to say", () => {
    expect(html(withToc(<DocsRelated />))).toBe("");
  });
});

describe("page footer links", () => {
  it("edits the page's own file", () => {
    expect(docsEditUrl("app/docs/teams/page.tsx")).toBe(
      `https://github.com/${APP_REPO}/edit/main/app/docs/teams/page.tsx`,
    );
  });

  it("prefills the page and section on a new issue", () => {
    const url = new URL(docsReportUrl("/docs/teams", "roles"));
    expect(url.pathname).toBe(`/${APP_REPO}/issues/new`);
    expect(url.searchParams.get("title")).toContain("/docs/teams");
    expect(url.searchParams.get("body")).toContain("/docs/teams#roles");
  });

  it("leaves the hash off before a section is known", () => {
    const url = new URL(docsReportUrl("/docs/teams", ""));
    expect(url.searchParams.get("body")).not.toContain("#");
  });
});

describe("Callout links", () => {
  const out = html(
    <Callout>
      <a href="/x">read more</a>
    </Callout>,
  );

  it("underlines them at rest, in a quiet decoration", () => {
    expect(out).toContain("[&amp;_a]:underline ");
    expect(out).toContain("[&amp;_a]:decoration-primary/40");
    expect(out).toContain("[&amp;_a]:underline-offset-2");
    expect(out).toContain("[&amp;_a:hover]:decoration-primary");
  });

  it("no longer hides the underline until hover", () => {
    expect(out).not.toContain("[&amp;_a]:hover:underline");
  });
});
