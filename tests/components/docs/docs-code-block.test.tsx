// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const copyToClipboard = vi.fn(async (_text: string) => true);
vi.mock("@/lib/ui/clipboard", () => ({
  copyToClipboard: (text: string) => copyToClipboard(text),
}));

import { CodeBlock, stripShellPrompt } from "@/components/docs/docs-code-block";
import { DocsCodeTabs } from "@/components/docs/docs-code-tabs";
import { DocsTabs } from "@/components/docs/docs-tabs";

afterEach(cleanup);

beforeEach(() => {
  copyToClipboard.mockClear();
  try {
    localStorage.clear();
  } catch {
    // jsdom always has storage; the guard matches the component's own.
  }
});

describe("stripShellPrompt", () => {
  it("removes a leading $ on each line and nothing else", () => {
    expect(stripShellPrompt("$ npm i\n$ npm test\noutput $ x")).toBe(
      "npm i\nnpm test\noutput $ x",
    );
  });
});

describe("CodeBlock", () => {
  it("is 13px at every width", () => {
    const { container } = render(<CodeBlock code="x" />);
    expect(container.querySelector("pre")!.className).toContain("text-[13px]");
    expect(container.querySelector("pre")!.className).not.toContain("text-xs");
  });

  it("bleeds to the screen edge on a phone only", () => {
    const { container } = render(<CodeBlock code="x" />);
    const figure = container.querySelector("figure")!.className;
    for (const token of [
      "-mx-4",
      "rounded-none",
      "border-x-0",
      "sm:mx-0",
      "sm:rounded-lg",
      "sm:border-x",
    ]) {
      expect(figure).toContain(token);
    }
  });

  it("shows a title and where a command runs", () => {
    render(<CodeBlock code="x" title="Request" shell="container" />);
    expect(screen.getByText("Request")).toBeTruthy();
    expect(screen.getByText("Inside the container")).toBeTruthy();
  });

  it("toggles wrapping", () => {
    const { container } = render(<CodeBlock code="x" />);
    const wrap = screen.getByRole("button", { name: /wrap long lines/i });
    expect(wrap.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("pre")!.className).not.toContain(
      "whitespace-pre-wrap",
    );
    fireEvent.click(wrap);
    expect(wrap.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("pre")!.className).toContain(
      "whitespace-pre-wrap",
    );
  });

  it("copies without the shell prompt and says so aloud", async () => {
    render(<CodeBlock code="$ npm test" language="bash" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /copy bash/i }));
    });
    expect(copyToClipboard).toHaveBeenCalledWith("npm test");
    expect(screen.getByRole("status").textContent).toContain("copied");
  });
});

const tabs = [
  { id: "curl", label: "cURL", language: "bash", code: "curl it" },
  { id: "python", label: "py", language: "python", code: "python it" },
];

describe("DocsCodeTabs", () => {
  it("renders every panel, hiding the inactive ones", () => {
    const { container } = render(<DocsCodeTabs tabs={tabs} />);
    const panels = [...container.querySelectorAll('[role="tabpanel"]')];
    expect(panels).toHaveLength(2);
    expect(panels[0].hasAttribute("hidden")).toBe(false);
    expect(panels[1].hasAttribute("hidden")).toBe(true);
    expect(container.textContent).toContain("python it");
  });

  it("uses the fixed language labels, whatever the call site typed", () => {
    render(<DocsCodeTabs tabs={tabs} />);
    expect(screen.getByRole("tab", { name: "curl" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Python" })).toBeTruthy();
  });

  it("switches every tab set in the group and remembers it", () => {
    const { container } = render(
      <>
        <DocsCodeTabs tabs={tabs} group="lang" />
        <DocsCodeTabs tabs={tabs} group="lang" />
      </>,
    );
    fireEvent.click(screen.getAllByRole("tab", { name: "Python" })[0]);
    const visible = [
      ...container.querySelectorAll('[role="tabpanel"]:not([hidden])'),
    ].map((panel) => panel.textContent);
    expect(visible.every((text) => text?.includes("python it"))).toBe(true);
    expect(visible).toHaveLength(2);
    expect(localStorage.getItem("vr-docs-tab:lang")).toBe("python");
  });

  it("survives storage that throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    render(<DocsCodeTabs tabs={tabs} group="blocked-group" />);
    expect(() =>
      fireEvent.click(screen.getByRole("tab", { name: "curl" })),
    ).not.toThrow();
    spy.mockRestore();
  });

  it("moves with the arrow keys", () => {
    render(<DocsCodeTabs tabs={tabs} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "curl" }), {
      key: "ArrowRight",
    });
    expect(
      screen.getByRole("tab", { name: "Python" }).getAttribute("aria-selected"),
    ).toBe("true");
  });
});

describe("DocsTabs", () => {
  it("renders every prose panel and hides the inactive one", () => {
    const { container } = render(
      <DocsTabs
        tabs={[
          { id: "app", label: "In the app", content: <p>App steps</p> },
          { id: "api", label: "With the API", content: <p>API steps</p> },
        ]}
      />,
    );
    expect(container.textContent).toContain("App steps");
    expect(container.textContent).toContain("API steps");
    expect(
      container.querySelectorAll('[role="tabpanel"][hidden]'),
    ).toHaveLength(1);
  });
});
