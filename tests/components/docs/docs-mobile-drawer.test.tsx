// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

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

import {
  DocsMobileNav,
  defaultDrawerTab,
} from "@/components/docs/docs-mobile-nav";
import { docsPageContext } from "@/components/docs/docs-nav";

afterEach(cleanup);

const toc = [
  { id: "roles", label: "Roles" },
  { id: "invites", label: "Invitations" },
];

function open(tocItems = toc, openTab = defaultDrawerTab(tocItems)) {
  return render(
    <DocsMobileNav
      tocItems={tocItems}
      activeSection="roles"
      openTab={openTab}
      onClose={() => {}}
    />,
  );
}

describe("defaultDrawerTab", () => {
  it("opens on the outline when the page has one", () => {
    expect(defaultDrawerTab(toc)).toBe("page");
  });

  it("opens on the whole set when it does not", () => {
    expect(defaultDrawerTab([])).toBe("all");
  });
});

describe("the docs drawer", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <DocsMobileNav
        tocItems={toc}
        activeSection=""
        openTab={null}
        onClose={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("starts on This page, listing the page's sections and not the site", () => {
    open();
    expect(screen.getByRole("tab", { name: "This page" })).toHaveProperty(
      "ariaSelected",
      "true",
    );
    expect(screen.getByRole("link", { name: "Roles" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Teams" })).toBeNull();
  });

  it("switches to the whole set", () => {
    open();
    fireEvent.click(screen.getByRole("tab", { name: "All docs" }));
    expect(screen.queryByRole("link", { name: "Roles" })).toBeNull();
    expect(
      screen.getByRole("link", { name: /^Teams/ }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("offers only All docs on a page with no outline", () => {
    open([]);
    expect(screen.queryByRole("tab", { name: "This page" })).toBeNull();
    expect(screen.getByRole("tab", { name: "All docs" })).toBeTruthy();
  });

  it("shows summaries only for the current group", () => {
    pathname = "/docs/teams";
    open(toc, "all");
    const { section } = docsPageContext(pathname);
    const inGroup = section!.items[0];
    expect(screen.getByText(inGroup.summary)).toBeTruthy();
    expect(
      screen.queryByText("Run scans from the terminal and gate CI on findings"),
    ).toBeNull();
  });

  it("keeps the page behind it from scrolling while open", () => {
    const { unmount } = open();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});
