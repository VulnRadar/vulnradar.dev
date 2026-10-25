import { describe, it, expect } from "vitest";
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
  const src = code("components/shared/language-menu.tsx");

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

  it("is not disabled while saving on the profile either", () => {
    const select = code("components/shared/language-select.tsx");
    expect(select).not.toMatch(/disabled=\{busy\}/);
    expect(select).toContain("aria-busy={busy}");
    expect(select).toContain("if (busy || next === current) return;");
  });
});
