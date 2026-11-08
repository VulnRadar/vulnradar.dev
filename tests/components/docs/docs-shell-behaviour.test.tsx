// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const replace = vi.fn();
const push = vi.fn();
let pathname = "/docs/teams";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace, push }),
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
  LandingNav: () => null,
}));
vi.mock("@/components/scanner/footer", () => ({ Footer: () => null }));
vi.mock("@/lib/docs/moved-anchors", () => ({
  resolveMovedAnchor: (path: string, hash: string) =>
    path === "/docs/teams" && hash === "#old" ? "/docs/sharing#new" : undefined,
}));

import { DocsShell } from "@/components/docs/docs-shell";
import { DocsSearch } from "@/components/docs/docs-search";
import {
  isSidebarGroupOpen,
  DocsSidebar,
} from "@/components/docs/docs-sidebar";
import { DOCS_NAV, docsPageContext } from "@/components/docs/docs-nav";
import { scrollRailToItem } from "@/components/docs/docs-toc";
import { DocsTocSpy } from "@/app/docs/docs-toc-spy";
import type { NavSection } from "@/components/docs/docs-types";

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
  pathname = "/docs/teams";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 404 })),
  );
  window.location.hash = "";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("moved anchors", () => {
  it("forwards a mapped hash on arrival", () => {
    window.location.hash = "#old";
    render(<DocsShell>page</DocsShell>);
    expect(replace).toHaveBeenCalledWith("/docs/sharing#new");
  });

  it("forwards when the hash changes on the page", () => {
    render(<DocsShell>page</DocsShell>);
    expect(replace).not.toHaveBeenCalled();
    window.location.hash = "#old";
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(replace).toHaveBeenCalledWith("/docs/sharing#new");
  });

  it("leaves an ordinary hash alone", () => {
    window.location.hash = "#roles";
    render(<DocsShell>page</DocsShell>);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("the scroll spy", () => {
  it("watches the registry's sections, and the rail follows it", () => {
    let report: IntersectionObserverCallback = () => {};
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          report = callback;
        }
        observe = observe;
        disconnect = vi.fn();
      },
    );
    const [first, second] = docsPageContext("/docs/teams").current!.toc;

    render(
      <DocsShell>
        <DocsTocSpy />
        <div id={first.id} />
        <div id={second.id} />
      </DocsShell>,
    );
    expect(observe.mock.calls.map(([el]) => el.id)).toEqual([
      first.id,
      second.id,
    ]);

    act(() =>
      report(
        [
          {
            isIntersecting: true,
            target: document.getElementById(second.id)!,
          } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      ),
    );
    const link = screen
      .getAllByRole("link", { name: second.label })
      .find((el) => el.getAttribute("href") === `#${second.id}`)!;
    expect(link.getAttribute("aria-current")).toBe("true");
  });
});

describe("scrollRailToItem", () => {
  const rail = (scrollTop: number) =>
    ({ scrollTop, clientHeight: 100 }) as HTMLElement;
  const item = (offsetTop: number) =>
    ({ offsetTop, offsetHeight: 20 }) as HTMLElement;

  it("scrolls up to an item above the viewport", () => {
    const r = rail(200);
    scrollRailToItem(r, item(150));
    expect(r.scrollTop).toBe(150);
  });

  it("scrolls down just far enough for an item below it", () => {
    const r = rail(0);
    scrollRailToItem(r, item(150));
    expect(r.scrollTop).toBe(70);
  });

  it("leaves a visible item alone", () => {
    const r = rail(100);
    scrollRailToItem(r, item(120));
    expect(r.scrollTop).toBe(100);
  });
});

describe("the sidebar groups", () => {
  const shared: NavSection = {
    id: "reference",
    title: "Reference",
    audience: "shared",
    items: [],
  };
  const use = DOCS_NAV.find((section) => section.audience === "use")!;
  const run = DOCS_NAV.find((section) => section.audience === "run")!;

  it("opens the current audience and collapses the others", () => {
    expect(isSidebarGroupOpen(use, "/docs/teams")).toBe(true);
    expect(isSidebarGroupOpen(run, "/docs/teams")).toBe(false);
  });

  it("always opens the shared reference", () => {
    expect(isSidebarGroupOpen(shared, "/docs/config")).toBe(true);
  });

  it("opens everything on the docs home", () => {
    expect(isSidebarGroupOpen(run, "/docs")).toBe(true);
  });

  it("renders collapsed groups as closed details with their heading", () => {
    render(<DocsSidebar />);
    const heading = screen.getByRole("heading", { name: run.title });
    expect(heading.closest("details")!.hasAttribute("open")).toBe(false);
    const own = screen.getByRole("heading", { name: use.title });
    expect(own.closest("details")!.hasAttribute("open")).toBe(true);
  });

  it("has dropped the page counter off a numbered path", () => {
    const { container } = render(<DocsSidebar />);
    expect(container.textContent).not.toMatch(/Page \d+ of \d+/);
    expect(container.textContent).not.toMatch(/Step \d+ of \d+/);
  });

  it("puts the search button at the top", () => {
    render(<DocsSidebar />);
    expect(
      screen.getByRole("button", { name: /search the docs/i }),
    ).toBeTruthy();
  });
});

describe("the search shortcuts", () => {
  function press(init: KeyboardEventInit, target: EventTarget = document.body) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  it.each([
    [{ key: "k", ctrlKey: true }],
    [{ key: "k", metaKey: true }],
    [{ key: "/" }],
  ])("%o opens the search", (init) => {
    const onOpenChange = vi.fn();
    render(<DocsSearch open={false} onOpenChange={onOpenChange} />);
    expect(press(init).defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("keeps Ctrl K from reaching the site-wide palette", () => {
    const palette = vi.fn();
    document.addEventListener("keydown", palette);
    render(<DocsSearch open={false} onOpenChange={() => {}} />);
    press({ key: "k", ctrlKey: true });
    document.removeEventListener("keydown", palette);
    expect(palette).not.toHaveBeenCalled();
  });

  it("does not steal / from someone typing", () => {
    const onOpenChange = vi.fn();
    render(
      <>
        <input aria-label="field" />
        <DocsSearch open={false} onOpenChange={onOpenChange} />
      </>,
    );
    press({ key: "/" }, screen.getByLabelText("field"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("the search dialog", () => {
  it("focuses the input, finds a page, and opens it on Enter", async () => {
    // A page in the same audience as /docs/webhooks, which is ranked first.
    pathname = "/docs/api";
    const onOpenChange = vi.fn();
    render(<DocsSearch open onOpenChange={onOpenChange} />);
    const input = screen.getByRole("combobox", { name: "Search the docs" });
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.change(input, { target: { value: "webhooks" } });
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining("/docs/webhooks"),
    );
  });

  it("says so when nothing matches", () => {
    render(<DocsSearch open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzzqqq" },
    });
    expect(screen.getByText("Nothing in the docs matches that.")).toBeTruthy();
  });

  it("is a full-screen sheet on a phone with 44px rows", () => {
    render(<DocsSearch open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "webhooks" },
    });
    expect(screen.getByRole("dialog").className).toContain("max-sm:inset-0");
    expect(screen.getAllByRole("option")[0].className).toContain("min-h-11");
  });
});
