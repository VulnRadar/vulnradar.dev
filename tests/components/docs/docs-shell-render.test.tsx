import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let pathname = "/docs/teams";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
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
vi.mock("@/components/landing/landing-nav", () => ({
  LandingNav: () => <nav data-testid="site-nav" />,
}));
vi.mock("@/components/scanner/footer", () => ({ Footer: () => null }));

import { DocsShell } from "@/components/docs/docs-shell";
import { DocsHero } from "@/components/docs/docs-hero";
import { docsPageContext } from "@/components/docs/docs-nav";
import { DocsTocSpy } from "@/app/docs/docs-toc-spy";

function shellHtml(path: string, children: ReactNode = <p>Body</p>): string {
  pathname = path;
  return renderToStaticMarkup(<DocsShell>{children}</DocsShell>);
}

describe("the shell's table of contents", () => {
  it("is in the server's HTML, with no page having told it anything", () => {
    const html = shellHtml("/docs/teams");
    for (const entry of docsPageContext("/docs/teams").current!.toc) {
      expect(html).toContain(`href="#${entry.id}"`);
    }
  });

  it("reserves the rail column on a page with a contents list", () => {
    expect(shellHtml("/docs/teams")).toContain("w-56");
  });

  it("draws no rail for a page outside the registry", () => {
    const html = shellHtml("/docs/not-in-the-registry");
    expect(html).not.toContain("w-56");
    expect(html).not.toContain("On this page:");
  });

  it("shows where you are in the bar", () => {
    expect(shellHtml("/docs/teams")).toContain("On this page: ");
  });

  it("no longer draws the floating pill", () => {
    const html = shellHtml("/docs/teams");
    expect(html).not.toContain("Contents</span>");
    expect(html).not.toContain("bottom-[calc(5rem");
  });

  it("renders the page footer above the pager", () => {
    const html = shellHtml("/docs/teams");
    expect(html.indexOf("Edit this page on GitHub")).toBeGreaterThan(-1);
    expect(html.indexOf("Report a problem with this page")).toBeGreaterThan(-1);
    expect(html.indexOf("Edit this page on GitHub")).toBeLessThan(
      html.indexOf('aria-label="Documentation pages"'),
    );
  });
});

describe("DocsTocSpy", () => {
  it("still accepts the items prop pages pass today, and renders nothing", () => {
    expect(renderToStaticMarkup(<DocsTocSpy items={[]} />)).toBe("");
  });
});

describe("DocsHero", () => {
  const render = (badge?: string) => {
    pathname = "/docs/teams";
    return renderToStaticMarkup(
      <DocsHero badge={badge} title="Teams" description="d" />,
    );
  };

  it("takes its kicker from the registry when no badge is passed", () => {
    expect(render()).toContain(docsPageContext("/docs/teams").section!.title);
  });

  it("still honours a badge until the pages stop passing one", () => {
    expect(render("Account")).toContain("Account");
  });

  it("has no inline contents list any more", () => {
    expect(render()).not.toContain("<details");
  });
});
