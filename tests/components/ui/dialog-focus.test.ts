/**
 * Where keyboard focus goes when a dialog closes.
 *
 * Radix's modal Content answers its close-autofocus event by focusing its
 * <DialogTrigger>, and almost no dialog here renders one: every useConfirm()
 * call, the profile save modal and the ticket "Close ticket" confirm open from
 * state. Focus fell to <body> on close (SC 2.4.3). components/ui/dialog-focus.ts
 * is the fix, shared by DialogContent, AlertDialogContent and SheetContent.
 *
 * There is no DOM in this suite (vitest runs in node, with no jsdom), so the
 * decision is exercised against plain objects that implement the slice of the
 * DOM it reads, and the three wrappers are checked at the source for the wiring
 * a behavioural test cannot see: that the origin is recorded ahead of the
 * panel's own subtree and that the spread of caller props cannot clobber it.
 * The same wiring was also run in a real browser against Radix 1.2: cancel,
 * Escape and confirm on a useConfirm dialog land on the opener, an `autoFocus`
 * dialog restores too, and the confirmed-row-removed case lands on the h1.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// There is no renderer in this suite, so the two hooks are stood in for by what
// they amount to here: a ref is a box, and DialogFocusOrigin is a layout effect
// with no markup, so running its body inline lets the test call the component
// as a plain function.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: <T>(initial: T) => ({ current: initial }),
    useLayoutEffect: (fn: () => void) => {
      fn();
    },
  };
});

import {
  composeAutoFocus,
  DialogFocusOrigin,
  focusPageHeading,
  rememberableElement,
  restoreFocusOnClose,
  useDialogFocusRestore,
  type FocusDocument,
} from "@/components/ui/dialog-focus";

interface FakeEl {
  isConnected: boolean;
  disabled: boolean;
  takesFocus: boolean;
  attrs: Record<string, string>;
  focusCalls: unknown[];
  focus(options?: unknown): void;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
}

interface FakeDoc extends FocusDocument {
  headings: { main: FakeEl | null; any: FakeEl | null };
  body: Element;
  activeElement: Element | null;
}

function makeDoc(): FakeDoc {
  const doc = {
    body: { tag: "body" } as unknown as Element,
    activeElement: null as Element | null,
    headings: { main: null as FakeEl | null, any: null as FakeEl | null },
    querySelector(selector: string) {
      const found =
        selector === "main h1" ? doc.headings.main : doc.headings.any;
      return found as unknown as Element | null;
    },
  };
  doc.activeElement = doc.body;
  return doc;
}

function makeEl(
  doc: FakeDoc,
  over: Partial<Pick<FakeEl, "isConnected" | "disabled" | "takesFocus">> = {},
): FakeEl & HTMLElement {
  const el: FakeEl = {
    isConnected: true,
    disabled: false,
    takesFocus: true,
    attrs: {},
    focusCalls: [],
    ...over,
    focus(options?: unknown) {
      el.focusCalls.push(options);
      if (el.takesFocus) doc.activeElement = el as unknown as Element;
    },
    hasAttribute: (name) => name in el.attrs,
    setAttribute: (name, value) => {
      el.attrs[name] = value;
    },
  };
  return el as FakeEl & HTMLElement;
}

function makeEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

/** Runs queued work immediately, standing in for queueMicrotask. */
const runNow = (fn: () => void) => fn();

describe("rememberableElement", () => {
  it("remembers a real element", () => {
    const doc = makeDoc();
    const el = makeEl(doc);
    expect(rememberableElement(el as unknown as Element, doc)).toBe(el);
  });

  it("does not remember <body> or nothing: that is no origin at all", () => {
    const doc = makeDoc();
    expect(rememberableElement(doc.body, doc)).toBeNull();
    expect(rememberableElement(null, doc)).toBeNull();
  });
});

describe("composeAutoFocus", () => {
  it("runs the caller first, then ours", () => {
    const order: string[] = [];
    composeAutoFocus(
      () => order.push("caller"),
      () => order.push("ours"),
    )(makeEvent() as unknown as Event);
    expect(order).toEqual(["caller", "ours"]);
  });

  it("stands down when the caller took over with preventDefault", () => {
    const ours = vi.fn();
    composeAutoFocus(
      (e) => e.preventDefault(),
      ours,
    )(makeEvent() as unknown as Event);
    expect(ours).not.toHaveBeenCalled();
  });

  it("works with no caller handler at all", () => {
    const ours = vi.fn();
    composeAutoFocus(undefined, ours)(makeEvent() as unknown as Event);
    expect(ours).toHaveBeenCalledTimes(1);
  });
});

describe("focusPageHeading", () => {
  it("focuses the h1 without scrolling and makes it focusable from script", () => {
    const doc = makeDoc();
    const h1 = makeEl(doc);
    doc.headings.any = h1;
    expect(focusPageHeading(doc)).toBe(true);
    expect(h1.attrs.tabindex).toBe("-1");
    // The viewport stays where the user was working; only focus moves.
    expect(h1.focusCalls).toEqual([{ preventScroll: true }]);
    expect(doc.activeElement).toBe(h1);
  });

  it("prefers the h1 inside <main>", () => {
    const doc = makeDoc();
    const inMain = makeEl(doc);
    const other = makeEl(doc);
    doc.headings.main = inMain;
    doc.headings.any = other;
    focusPageHeading(doc);
    expect(doc.activeElement).toBe(inMain);
  });

  it("leaves an existing tabindex alone", () => {
    const doc = makeDoc();
    const h1 = makeEl(doc);
    h1.attrs.tabindex = "0";
    doc.headings.any = h1;
    focusPageHeading(doc);
    expect(h1.attrs.tabindex).toBe("0");
  });

  it("reports false when the page has no h1", () => {
    expect(focusPageHeading(makeDoc())).toBe(false);
  });
});

describe("restoreFocusOnClose", () => {
  it("returns focus to the element that opened the dialog", () => {
    const doc = makeDoc();
    const opener = makeEl(doc);
    const event = makeEvent();
    restoreFocusOnClose(event, { origin: opener, doc, defer: runNow });
    expect(doc.activeElement).toBe(opener);
    // Prevented, so Radix does not then focus a trigger over the top of it.
    expect(event.defaultPrevented).toBe(true);
  });

  it("falls back to the page heading when the confirmed action removed the opener", () => {
    const doc = makeDoc();
    const h1 = makeEl(doc);
    doc.headings.any = h1;
    const removed = makeEl(doc, { isConnected: false });
    restoreFocusOnClose(makeEvent(), { origin: removed, doc, defer: runNow });
    expect(removed.focusCalls).toEqual([]);
    expect(doc.activeElement).toBe(h1);
  });

  it("falls back to the heading when the opener is now disabled", () => {
    const doc = makeDoc();
    const h1 = makeEl(doc);
    doc.headings.any = h1;
    const opener = makeEl(doc, { disabled: true });
    restoreFocusOnClose(makeEvent(), { origin: opener, doc, defer: runNow });
    expect(opener.focusCalls).toEqual([]);
    expect(doc.activeElement).toBe(h1);
  });

  it("falls back to the heading when the opener refuses focus (hidden by the action)", () => {
    const doc = makeDoc();
    const h1 = makeEl(doc);
    doc.headings.any = h1;
    const opener = makeEl(doc, { takesFocus: false });
    const event = makeEvent();
    restoreFocusOnClose(event, { origin: opener, doc, defer: runNow });
    expect(opener.focusCalls).toHaveLength(1);
    expect(doc.activeElement).toBe(h1);
    // Not prevented: a dialog that does have a trigger still gets Radix's own.
    expect(event.defaultPrevented).toBe(false);
  });

  it("uses the heading when the dialog had no origin at all", () => {
    const doc = makeDoc();
    const h1 = makeEl(doc);
    doc.headings.any = h1;
    restoreFocusOnClose(makeEvent(), { origin: null, doc, defer: runNow });
    expect(doc.activeElement).toBe(h1);
  });

  it("does not steal focus the page already placed elsewhere", () => {
    const doc = makeDoc();
    const opener = makeEl(doc);
    const h1 = makeEl(doc);
    doc.headings.any = h1;
    // The page moved focus to the next row after the delete.
    const nextRow = makeEl(doc);
    doc.activeElement = nextRow as unknown as Element;
    const event = makeEvent();
    restoreFocusOnClose(event, { origin: opener, doc, defer: runNow });
    expect(doc.activeElement).toBe(nextRow);
    expect(opener.focusCalls).toEqual([]);
    expect(h1.focusCalls).toEqual([]);
    // Prevented, or Radix would haul focus to a trigger over the page's choice.
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not move focus to the heading if Radix's own trigger focus landed after us", () => {
    const doc = makeDoc();
    const h1 = makeEl(doc);
    doc.headings.any = h1;
    const trigger = makeEl(doc);
    let queued: (() => void) | null = null;
    restoreFocusOnClose(makeEvent(), {
      origin: null,
      doc,
      defer: (fn) => {
        queued = fn;
      },
    });
    // Radix's internal handler runs after ours, in the same dispatch.
    trigger.focus();
    (queued as (() => void) | null)?.();
    expect(doc.activeElement).toBe(trigger);
    expect(h1.focusCalls).toEqual([]);
  });

  it("does nothing, and does not throw, when there is no heading either", () => {
    const doc = makeDoc();
    expect(() =>
      restoreFocusOnClose(makeEvent(), { origin: null, doc, defer: runNow }),
    ).not.toThrow();
    expect(doc.activeElement).toBe(doc.body);
  });
});

describe("useDialogFocusRestore + DialogFocusOrigin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("records what had focus at open and restores it at close", () => {
    const doc = makeDoc();
    vi.stubGlobal("document", doc);
    const opener = makeEl(doc);
    doc.activeElement = opener as unknown as Element;

    const hook = useDialogFocusRestore();
    DialogFocusOrigin({ originRef: hook.originRef });
    expect(hook.originRef.current).toBe(opener);

    // The dialog took focus, then unmounted and focus fell to <body>.
    doc.activeElement = doc.body;
    hook.onCloseAutoFocus(makeEvent() as unknown as Event);
    expect(doc.activeElement).toBe(opener);
  });

  it("forgets the origin once used, so a later opening never restores a stale node", () => {
    const doc = makeDoc();
    vi.stubGlobal("document", doc);
    const opener = makeEl(doc);
    doc.activeElement = opener as unknown as Element;
    const hook = useDialogFocusRestore();
    DialogFocusOrigin({ originRef: hook.originRef });
    doc.activeElement = doc.body;
    hook.onCloseAutoFocus(makeEvent() as unknown as Event);
    expect(hook.originRef.current).toBeNull();
  });

  it("keeps the first reading when the layout effect runs again (StrictMode in dev)", () => {
    const doc = makeDoc();
    vi.stubGlobal("document", doc);
    const opener = makeEl(doc);
    doc.activeElement = opener as unknown as Element;
    const hook = useDialogFocusRestore();
    DialogFocusOrigin({ originRef: hook.originRef });
    // The panel's autoFocus input has focus by the time React re-runs the
    // effect, and it is inside the dialog, so it is gone once the dialog closes.
    const input = makeEl(doc);
    doc.activeElement = input as unknown as Element;
    DialogFocusOrigin({ originRef: hook.originRef });
    expect(hook.originRef.current).toBe(opener);

    input.isConnected = false;
    doc.activeElement = doc.body;
    hook.onCloseAutoFocus(makeEvent() as unknown as Event);
    expect(doc.activeElement).toBe(opener);
  });

  it("records afresh for the next opening once a close has emptied the ref", () => {
    const doc = makeDoc();
    vi.stubGlobal("document", doc);
    const first = makeEl(doc);
    const second = makeEl(doc);
    const hook = useDialogFocusRestore();
    doc.activeElement = first as unknown as Element;
    DialogFocusOrigin({ originRef: hook.originRef });
    doc.activeElement = doc.body;
    hook.onCloseAutoFocus(makeEvent() as unknown as Event);

    doc.activeElement = second as unknown as Element;
    DialogFocusOrigin({ originRef: hook.originRef });
    expect(hook.originRef.current).toBe(second);
  });

  it("records nothing when <body> had focus", () => {
    const doc = makeDoc();
    vi.stubGlobal("document", doc);
    const hook = useDialogFocusRestore();
    DialogFocusOrigin({ originRef: hook.originRef });
    expect(hook.originRef.current).toBeNull();
  });

  it("composes with the caller's onCloseAutoFocus: theirs first", () => {
    const doc = makeDoc();
    vi.stubGlobal("document", doc);
    const opener = makeEl(doc);
    doc.activeElement = opener as unknown as Element;
    const calls: string[] = [];
    const hook = useDialogFocusRestore(() => calls.push("caller"));
    DialogFocusOrigin({ originRef: hook.originRef });
    doc.activeElement = doc.body;
    const event = makeEvent();
    hook.onCloseAutoFocus(event as unknown as Event);
    expect(calls).toEqual(["caller"]);
    expect(doc.activeElement).toBe(opener);
  });

  it("stands down when the caller's handler called preventDefault, and still clears the origin", () => {
    const doc = makeDoc();
    vi.stubGlobal("document", doc);
    const opener = makeEl(doc);
    doc.activeElement = opener as unknown as Element;
    const hook = useDialogFocusRestore((e) => e.preventDefault());
    DialogFocusOrigin({ originRef: hook.originRef });
    doc.activeElement = doc.body;
    hook.onCloseAutoFocus(makeEvent() as unknown as Event);
    expect(opener.focusCalls).toEqual([]);
    expect(doc.activeElement).toBe(doc.body);
    expect(hook.originRef.current).toBeNull();
  });
});

describe("the three wrappers are wired to it", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it.each([
    ["components/ui/dialog.tsx", "<DialogOverlay />"],
    ["components/ui/alert-dialog.tsx", "<AlertDialogOverlay />"],
    ["components/ui/sheet.tsx", "<SheetOverlay />"],
  ])(
    "%s records the origin ahead of the panel and keeps the spread from clobbering it",
    (rel, overlay) => {
      const src = read(rel);
      expect(src).toContain('from "@/components/ui/dialog-focus"');
      // First child of the portal, so its layout effect commits before the
      // panel's subtree: an autoFocus input inside would otherwise have already
      // taken focus, and onOpenAutoFocus never fires for that case.
      const origin = src.indexOf("<DialogFocusOrigin");
      expect(origin).toBeGreaterThan(-1);
      expect(origin).toBeLessThan(src.indexOf(overlay));
      // The caller's handlers are pulled out of props before the spread, then
      // composed. Left in the spread they would replace ours wholesale.
      expect(src).toMatch(/onOpenAutoFocus,\s*onCloseAutoFocus,\s*\.\.\.props/);
      expect(src).toContain("useDialogFocusRestore(onCloseAutoFocus)");
      expect(src).toContain("onCloseAutoFocus={focus.onCloseAutoFocus}");
      expect(src).toContain("composeAutoFocus(onOpenAutoFocus");
    },
  );

  it("Select no longer cancels Radix's own focus return", () => {
    const src = read("components/ui/select.tsx");
    // A comment may mention it; an attribute on the Content may not.
    expect(src).not.toMatch(/^\s*onCloseAutoFocus=/m);
  });
});
