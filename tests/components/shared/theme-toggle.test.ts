import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The theme switch has to render the same markup on the server and on the
 * client's first pass. It was drawn from `resolvedTheme`, which next-themes
 * leaves undefined on the server and reads from storage on the client, so a
 * light-theme visitor hydrated a thumb on the dark side: React keeps the
 * server's attributes on a mismatch and nothing re-rendered to correct them.
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

describe("the theme toggle", () => {
  const src = code("components/shared/theme-toggle.tsx");

  it("does not choose any class from the resolved theme", () => {
    // A className that reads isDark is a className that differs between the
    // server and a light-theme client. In the markup it may appear twice: the
    // guarded aria-checked and the click handler, neither of which is a class.
    const markup = src.slice(src.indexOf("return ("));
    expect(markup.match(/\bisDark\b/g)).toHaveLength(2);
    expect(markup).toContain("aria-checked={mounted ? isDark : true}");
    expect(markup).toContain('setTheme(isDark ? "light" : "dark")');
    expect(markup).not.toMatch(/className=\{[^}]*isDark/);
  });

  it("draws both icons everywhere and lets the dark class pick", () => {
    // The two icons on the track, and the two on the thumb.
    expect(src.match(/<Sun\b/g)).toHaveLength(2);
    expect(src.match(/<Moon\b/g)).toHaveLength(2);
    expect(src).toContain("dark:translate-x-8");
    expect(src).toContain("dark:bg-muted");
    expect(src).toContain("dark:opacity-40");
    expect(src).toContain("dark:opacity-0");
    expect(src).toContain("dark:block");
    expect(src).toContain("dark:hidden");
  });

  it("holds aria-checked at the server's value until it has mounted", () => {
    expect(src).toContain("aria-checked={mounted ? isDark : true}");
    expect(src).toContain("useSyncExternalStore");
    // false for the server and for hydration, true after.
    expect(src).toMatch(/\(\) => true,\s*\(\) => false/);
  });

  it("stays a labelled switch", () => {
    expect(src).toContain('role="switch"');
    expect(src).toContain('aria-label="Dark mode"');
  });

  it("flips to the opposite theme from the one resolved", () => {
    expect(src).toContain('setTheme(isDark ? "light" : "dark")');
  });
});

describe("the dark: variant the toggle relies on", () => {
  it("follows the dark class next-themes sets, not the OS", () => {
    // Under Tailwind v4 this config is bridged in with @config. If it ever
    // became "media", every dark: class here would follow the operating system
    // and ignore the toggle.
    expect(code("tailwind.config.mjs")).toContain('darkMode: "class"');
    expect(
      fs.readFileSync(path.join(ROOT, "app/globals.css"), "utf8"),
    ).toContain("@config '../tailwind.config.mjs'");
  });

  it("is applied by the same attribute the provider writes", () => {
    const layout = code("app/layout.tsx");
    expect(layout).toContain('attribute="class"');
  });
});
