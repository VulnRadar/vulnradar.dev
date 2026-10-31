import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * auth-shell.tsx carried a private useFocusOnMount that focused its heading
 * unconditionally. lib/hooks/use-focus-on-mount.ts is the shared one, and it
 * adds the rule that matters: focus is only taken when the control the person
 * was on has gone and left it on <body>, never from an element they moved to
 * themselves.
 *
 * Source-text assertions: the suite runs under `node` with no DOM. The hook's
 * behaviour is covered in tests/lib/hooks/use-focus-on-mount.test.ts.
 */

const ROOT = path.resolve(__dirname, "../../..");

function code(rel: string): string {
  return fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("auth-shell focus", () => {
  const src = code("components/auth/auth-shell.tsx");

  it("imports the shared hook and defines no local copy", () => {
    expect(src).toContain(
      'import { useFocusOnMount } from "@/lib/hooks/use-focus-on-mount";',
    );
    expect(src).not.toMatch(/function useFocusOnMount\b/);
  });

  it("no longer needs its own effect or ref", () => {
    expect(src).not.toMatch(/\buseEffect\b/);
    expect(src).not.toMatch(/\buseRef\b/);
  });

  it("AuthHeading hands its focusOnMount prop to the hook as `enabled`", () => {
    expect(src).toMatch(
      /useFocusOnMount<HTMLHeadingElement>\(undefined,\s*\{\s*enabled:\s*focusOnMount,?\s*\}\)/,
    );
  });

  it("AuthOutcome always focuses its heading", () => {
    expect(src).toMatch(/useFocusOnMount<HTMLHeadingElement>\(\)/);
  });
});
