import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The class and wiring contract of InfoHint, as source-text assertions.
 *
 * The suite runs under `node` with no DOM and vitest cannot transform this
 * repo's `jsx: preserve` components, so a render is not available; the open and
 * close rules live in info-hint-state.ts and are tested as a function there.
 * What is pinned here is everything the browser checks of the prototype turned
 * on: the accessible name and description, the tap area, the panel role, and
 * that neither opening nor closing moves focus.
 */

const ROOT = path.resolve(__dirname, "../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/** Comments stripped, so prose that names a class cannot satisfy the match. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const HINT = "components/shared/info-hint.tsx";
const hint = code(HINT);

/** The class strings of the trigger button: from `<button` to its `>`. */
function triggerBlock(): string {
  const start = hint.indexOf("<button");
  const end = hint.indexOf("</button>");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return hint.slice(start, end);
}

describe("InfoHint: module shape", () => {
  it("is a client component whose first line says so", () => {
    expect(read(HINT).split("\n")[0]).toBe('"use client";');
  });

  it("draws the Info glyph and never the older help icons", () => {
    expect(hint).toMatch(/import \{ Info \} from "lucide-react"/);
    expect(hint).not.toMatch(/HelpCircle|CircleHelp/);
  });

  it("is built on the shared Popover, not a second primitive", () => {
    expect(hint).toContain('from "@/components/ui/popover"');
    expect(hint).not.toMatch(/react-tooltip|react-hover-card|ui\/tooltip/);
  });

  it("takes its focus ring from the shared helper", () => {
    expect(hint).toMatch(/import \{ focus \} from "@\/lib\/ui\/animations"/);
    expect(triggerBlock()).toContain("focus.ring");
  });

  it("takes its rules from the state module, which has no React in it", () => {
    expect(hint).toContain('from "./info-hint-state"');
    expect(read("components/shared/info-hint-state.ts")).not.toMatch(
      /from ["']react["']|from ["']react\//,
    );
  });
});

describe("InfoHint: the trigger", () => {
  const trigger = triggerBlock();

  it("is a real button with a required label as its accessible name", () => {
    expect(trigger).toContain('type="button"');
    expect(trigger).toContain("aria-label={label}");
    expect(hint).toMatch(/\n\s+label: string;/);
  });

  it("points aria-describedby at a hidden copy of the explanation", () => {
    expect(trigger).toContain("aria-describedby={descriptionId}");
    expect(hint).toMatch(/<span id=\{descriptionId\} hidden>\s*\{children\}/);
  });

  it("drops the dialog role Radix would announce", () => {
    expect(trigger).toContain("aria-haspopup={undefined}");
  });

  it("is 24 by 24, a round control", () => {
    expect(trigger).toContain("h-6 w-6");
    expect(trigger).toContain("rounded-full");
    expect(trigger).not.toMatch(
      /rounded-(md|sm|lg|xl|none)\b|(?<![\w-])rounded(?![\w-])/,
    );
  });

  it("grows its tap area on a coarse pointer without moving anything", () => {
    expect(trigger).toContain("pointer-coarse:after:absolute");
    expect(trigger).toContain("pointer-coarse:after:-inset-1.5");
  });

  it("uses the full-strength muted colour, not a faded one", () => {
    // /60 measured 2.56:1 on the light theme; the floor for a control is 3:1.
    expect(trigger).toContain("text-muted-foreground");
    expect(trigger).not.toMatch(/text-muted-foreground\/\d/);
  });

  it("shows state with colour only: no scale, translate, rotate or animation", () => {
    expect(trigger).toContain("transition-colors");
    expect(trigger).not.toMatch(
      /scale-|translate-|rotate-|animate-|transition-all|transition-transform/,
    );
  });

  it("feeds pointer, focus, blur and click into the state machine", () => {
    for (const handler of [
      "onPointerEnter",
      "onPointerLeave",
      "onFocus",
      "onBlur",
      "onClick",
    ]) {
      expect(trigger).toContain(handler);
    }
    expect(trigger).toContain("e.pointerType");
    expect(read(HINT)).toContain(":focus-visible");
  });

  it("treats a click with no detail as the keyboard", () => {
    expect(trigger).toContain("e.detail === 0");
    expect(trigger).toContain("e.preventDefault()");
  });
});

describe("InfoHint: the panel", () => {
  it("is a tooltip, not an unnamed dialog", () => {
    expect(hint).toContain('role="tooltip"');
  });

  it("is a rounded-lg callout, capped to the viewport", () => {
    expect(hint).toContain("rounded-lg");
    expect(hint).toContain("max-w-[calc(100vw-2rem)]");
  });

  it("never moves focus in on open or back to the trigger on close", () => {
    expect(hint).toMatch(/onOpenAutoFocus=\{\(e\) => e\.preventDefault\(\)\}/);
    expect(hint).toMatch(/onCloseAutoFocus=\{\(e\) => e\.preventDefault\(\)\}/);
  });

  it("can be crossed into, so the text is selectable", () => {
    expect(hint).toContain('send({ type: "content-enter" })');
    expect(hint).toContain('send({ type: "content-leave" })');
  });

  it("keeps a focus-held hint open through the scroll Tab causes", () => {
    expect(hint).toContain("closeOnScroll={closesOnPageScroll(state)}");
  });

  it("closes on the Radix dismissal (Escape, outside press) and nothing else", () => {
    expect(hint).toMatch(/if \(!next\) send\(\{ type: "dismiss" \}\)/);
  });

  it("owns no z-index of its own", () => {
    expect(hint).not.toMatch(/\bz-\d+|z-\[/);
  });

  it("has a required label and a bounded size and side API", () => {
    expect(hint).toContain("size?: keyof typeof PANEL_WIDTH");
    expect(hint).toMatch(
      /PANEL_WIDTH = \{ sm: "w-64", md: "w-72", lg: "w-80" \}/,
    );
    expect(hint).toContain('side?: "top" | "bottom" | "left" | "right"');
  });
});

describe("the Popover wrapper's closeOnScroll prop", () => {
  const popover = code("components/ui/popover.tsx");

  it("defaults to true so every existing popover still closes on scroll", () => {
    expect(popover).toContain("closeOnScroll = true");
  });

  it("gates the scroll listener on it", () => {
    expect(popover).toContain(
      "useCloseOnScroll(actualOpen && closeOnScroll, close)",
    );
  });

  it("is not forwarded to Radix, which would put it on the DOM", () => {
    const root = popover.slice(popover.indexOf("<PopoverPrimitive.Root"));
    expect(root.slice(0, root.indexOf("/>"))).not.toContain("closeOnScroll");
  });
});
