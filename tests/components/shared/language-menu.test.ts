import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The header's language switcher and the profile's. The menu marked the
 * current language with a tick no screen reader could see, discarded the
 * hook's error so a failed save looked like nothing had happened, and
 * disabled its trigger while saving: Radix returns focus to the trigger as
 * the menu closes, and a button disabled in that same commit cannot hold it,
 * so focus fell to the page body after every choice.
 *
 * Source-text assertions, like the rest of tests/components: tsconfig keeps
 * `jsx: preserve`, so a .tsx component cannot be imported into a test.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the language menu", () => {
  const src = code("components/shared/language-menu-impl.tsx");

  it("is a radio group, so the current language is exposed, not just drawn", () => {
    expect(src).toContain("<DropdownMenuRadioGroup value={current}");
    expect(src).toContain("<DropdownMenuRadioItem");
    expect(src).not.toContain("<DropdownMenuItem");
    // The tick that only sighted users could see.
    expect(src).not.toContain("<Check");
  });

  it("shows busy with aria-busy, not by disabling the trigger", () => {
    expect(src).toContain("aria-busy={busy}");
    expect(src).not.toMatch(/disabled=\{busy\}/);
    expect(src).not.toContain("disabled:opacity");
  });

  it("surfaces the hook's error", () => {
    expect(src).toContain(
      "const { setLanguage, busy, error } = useSetLanguage()",
    );
    expect(src).toMatch(
      /useEffect\(\(\) => \{\s*if \(!error\) return;\s*toast\(/,
    );
  });

  it("ignores a second pick while one is saving", () => {
    expect(src).toContain("if (busy || next === current");
  });

  it("opens as it mounts when the reader's own press loaded it", () => {
    expect(src).toContain("<DropdownMenu defaultOpen={defaultOpen}>");
  });

  it("takes focus when it replaces a focused button, and only then", () => {
    // An open menu moves focus into its list itself and hands it back to the
    // trigger on close; doing both would fight it.
    expect(src).toContain("if (focusTrigger && !defaultOpen)");
    expect(src).toContain("triggerRef.current?.focus()");
    expect(src).toContain("ref={triggerRef}");
  });

  it("is not disabled while saving on the profile either", () => {
    const select = code("components/shared/language-select.tsx");
    expect(select).not.toMatch(/disabled=\{busy\}/);
    expect(select).toContain("aria-busy={busy}");
    expect(select).toContain("if (busy || next === current) return;");
  });
});

describe("the language button in the header", () => {
  const shell = code("components/shared/language-menu.tsx");
  const trigger = code("components/shared/language-menu-trigger.ts");

  it("does not import the menu, the dropdown or the save hook", () => {
    // That is the whole point: the header carries a button, not the menu.
    expect(shell).not.toMatch(
      /from\s+["']@\/components\/ui\/dropdown-menu["']/,
    );
    expect(shell).not.toMatch(
      /from\s+["']@\/components\/shared\/use-set-language["']/,
    );
    expect(shell).not.toMatch(/from\s+["']@\/components\/ui\/use-toast["']/);
    expect(shell).not.toMatch(
      /^import\s+(?!type\b)[^;]*from\s+["']@\/components\/shared\/language-menu-impl["']/m,
    );
    const loader = code("components/shared/language-menu-loader.ts");
    expect(loader).toContain(
      'import("@/components/shared/language-menu-impl")',
    );
    expect(loader).not.toMatch(
      /^import\s+(?!type\b)[^;]*from\s+["']@\/components\/shared\/language-menu-impl["']/m,
    );
  });

  it("wears the same classes as the real trigger, from one spelling", () => {
    expect(shell).toContain("className={languageTriggerClassName(className)}");
    expect(code("components/shared/language-menu-impl.tsx")).toContain(
      "className={languageTriggerClassName(className)}",
    );
    // The size, the circle and the focus ring the swap must not change.
    expect(trigger).toContain("h-11 w-11");
    expect(trigger).toContain("sm:h-9 sm:w-9");
    expect(trigger).toContain("rounded-full");
    expect(trigger).toContain("focus.ring");
  });

  it("loads the menu on hover, focus, touch and press", () => {
    expect(shell).toContain("onPointerEnter={warm}");
    expect(shell).toContain("onFocus={warm}");
    expect(shell).toContain("onTouchStart={warm}");
    expect(shell).toMatch(
      /onClick=\{\(\) => \{[^}]*wantsOpen\.current = true;[^}]*warm\(\);/,
    );
  });

  it("is a labelled button that announces a menu, as the real trigger does", () => {
    expect(shell).toContain('aria-label={t("select")}');
    expect(shell).toContain('aria-haspopup="menu"');
    expect(shell).toContain("aria-expanded={false}");
    expect(shell).toContain('type="button"');
  });

  it("hands the reader's press and the button's focus to the menu", () => {
    expect(shell).toContain("defaultOpen={loaded.open}");
    expect(shell).toContain("focusTrigger={loaded.focus}");
    expect(shell).toContain("document.activeElement === buttonRef.current");
  });

  it("holds the swap while a pointer is down, so the click still lands on the button", () => {
    const settle = shell.slice(shell.indexOf("const settle"));
    expect(settle.slice(0, settle.indexOf("}, []);"))).toContain(
      "pointerDown.current",
    );
    expect(shell).toContain("onPointerDown={() => {");
    expect(shell).toContain("onPointerCancel={release}");
  });

  it("does not end a press when a touch pointer leaves, which happens before the click", () => {
    // pointerleave fires for a touch as the finger lifts, ahead of the click.
    // Releasing the hold there swapped the button out between the tap and its
    // click, and the Radix trigger that replaced it opens on pointerdown, so a
    // first tap on a touch screen opened nothing whenever the chunk arrived
    // while the finger was still down.
    expect(shell).not.toContain("onPointerLeave={release}");
    const leave = shell.slice(shell.indexOf("onPointerLeave="));
    expect(leave.slice(0, leave.indexOf("}}") + 2)).toContain(
      'event.pointerType !== "touch"',
    );
  });

  it("goes straight to the menu in a header that mounts after it was loaded", () => {
    expect(shell).toContain("peekLanguageMenuImpl()");
  });
});

describe("loadLanguageMenuImpl", () => {
  afterEach(() => {
    vi.doUnmock("@/components/shared/language-menu-impl");
    vi.resetModules();
  });

  async function freshLoader() {
    vi.resetModules();
    return import("@/components/shared/language-menu-loader");
  }

  it("imports the menu once however many events ask", async () => {
    const factory = vi.fn(() => ({ LanguageMenuImpl: () => null }));
    vi.doMock("@/components/shared/language-menu-impl", factory);
    const loader = await freshLoader();
    const [a, b, c] = await Promise.all([
      loader.loadLanguageMenuImpl(),
      loader.loadLanguageMenuImpl(),
      loader.loadLanguageMenuImpl(),
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(loader.peekLanguageMenuImpl()).toBe(a);
  });

  it("peeks nothing before anyone asked", async () => {
    const loader = await freshLoader();
    expect(loader.peekLanguageMenuImpl()).toBeNull();
  });

  it("forgets a failed import, so the next press tries again", async () => {
    let attempts = 0;
    vi.doMock("@/components/shared/language-menu-impl", () => {
      attempts++;
      if (attempts === 1) throw new Error("chunk 404");
      return { LanguageMenuImpl: () => null };
    });
    const loader = await freshLoader();
    await expect(loader.loadLanguageMenuImpl()).rejects.toThrow();
    expect(loader.peekLanguageMenuImpl()).toBeNull();
    const menu = await loader.loadLanguageMenuImpl();
    expect(typeof menu).toBe("function");
    expect(attempts).toBe(2);
  });
});
