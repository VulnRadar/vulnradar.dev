/**
 * When a script may move focus (lib/hooks/use-focus-on-mount.ts).
 *
 * The hook itself needs a DOM; the rule it applies does not. A view that has
 * just replaced the one the person was in may take focus only when focus has
 * been dropped on <body> by the control that was removed. Focus on a real
 * element means the person went there themselves.
 *
 * There is no renderer in this suite, so the two React hooks are stood in for
 * by what they amount to here: a ref is a box, and an effect is a function the
 * test runs once it has put an element in the box.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

const effects: Array<() => void> = [];

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: <T>(initial: T) => ({ current: initial }),
    useEffect: (fn: () => void) => {
      effects.push(fn);
    },
  };
});

import { canTakeFocus, useFocusOnMount } from "@/lib/hooks/use-focus-on-mount";

const body = { tagName: "BODY" } as unknown as Element;
const button = { tagName: "BUTTON" } as unknown as Element;

describe("canTakeFocus", () => {
  it("takes focus the removed control left on <body>", () => {
    expect(canTakeFocus(body, body)).toBe(true);
  });

  it("takes focus when nothing has it", () => {
    expect(canTakeFocus(null, body)).toBe(true);
  });

  it("leaves focus alone when the person is on a real element", () => {
    // They tabbed to Cancel, or to a header link: not ours to take back.
    expect(canTakeFocus(button, body)).toBe(false);
  });
});

describe("useFocusOnMount", () => {
  afterEach(() => {
    effects.length = 0;
    vi.unstubAllGlobals();
  });

  function target() {
    const calls: unknown[] = [];
    return {
      calls,
      el: {
        focus: (options?: unknown) => {
          calls.push(options);
        },
      } as unknown as HTMLElement,
    };
  }

  /**
   * Run the hook as a mount would: put `root` in the ref it returns, then run
   * the effect it registered. Named `use*` so the rules of hooks accept a
   * hook being called from it.
   */
  function useMounted(
    root: HTMLElement | null,
    args: Parameters<typeof useFocusOnMount<HTMLElement>>,
    active: Element | null = body,
  ) {
    vi.stubGlobal("document", { activeElement: active, body });
    effects.length = 0;
    const ref = useFocusOnMount<HTMLElement>(...args);
    (ref as { current: HTMLElement | null }).current = root;
    for (const run of effects) run();
  }

  it("focuses the ref'd element when focus was dropped on <body>", () => {
    const t = target();
    useMounted(t.el, []);
    expect(t.calls).toEqual([{ preventScroll: false }]);
  });

  it("focuses what pick names inside the root, not the root", () => {
    const root = target();
    const inner = target();
    useMounted(root.el, [() => inner.el]);
    expect(root.calls).toEqual([]);
    expect(inner.calls).toHaveLength(1);
  });

  it("does nothing when pick finds nothing", () => {
    const root = target();
    useMounted(root.el, [() => null]);
    expect(root.calls).toEqual([]);
  });

  it("does not take focus from an element the person is on", () => {
    const t = target();
    useMounted(t.el, [], button);
    expect(t.calls).toEqual([]);
  });

  it("does nothing when enabled is false", () => {
    const t = target();
    useMounted(t.el, [undefined, { enabled: false }]);
    expect(t.calls).toEqual([]);
  });

  it("can keep the viewport where it is", () => {
    const t = target();
    useMounted(t.el, [undefined, { preventScroll: true }]);
    expect(t.calls).toEqual([{ preventScroll: true }]);
  });

  it("does nothing before the ref is attached", () => {
    expect(() => useMounted(null, [])).not.toThrow();
  });
});
